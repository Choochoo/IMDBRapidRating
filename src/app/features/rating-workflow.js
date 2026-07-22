import { Config } from "../config.js";
import { BuildRateRequest, CanSubmitLive, IsRetryableImdbSubmit } from "../rating-records.js";
import { EscapeHtml, FormatCount } from "../util.js";
import { ReadMediaPayload, WriteMediaPayload } from "../../../shared/media.js";

const RatedStatus = "rated";
const FailedSubmitStatus = "failed";
const SavingClass = "saving";
const PutMethod = "PUT";

export class RatingWorkflowFeature {
  MarkActive(rating, status) {
    if (!this.CanMarkActiveTitle())
      return;
    this.State.locked = true;
    this.CommitActiveDecision(this.State.queue[0], rating, status).catch((error) => this.RecoverFromDecisionError(error));
  }

  CanMarkActiveTitle() {
    const hasActiveTitle = this.State.queue.length > 0;
    return !this.State.locked && hasActiveTitle && this.State.queueReady;
  }

  async CommitActiveDecision(movie, rating, status) {
    const request = this.BuildActiveDecisionRequest(movie, rating, status);
    const payload = await this.RequestJson(Config.raterDecisionUrl, PutMethod, request);
    this.ApplyCommittedDecision(payload, movie);
    this.FinishActiveDecision(movie, rating, status);
  }

  BuildActiveDecisionRequest(movie, rating, status) {
    return {
      mediaType: this.State.mediaType,
      actionId: this.NewActionId(),
      expectedRevision: this.State.queueRevision,
      kind: status,
      titleId: movie.ttId,
      title: movie.title,
      year: movie.year || "",
      genres: Array.isArray(movie.genres) ? movie.genres : [],
      rating,
      at: new Date().toISOString()
    };
  }

  FinishActiveDecision(movie, rating, status) {
    if (status === RatedStatus)
      this.EnqueueLiveSubmit(movie.ttId);
    this.AnimateActiveCard(status);
    this.ShowRatingToast(movie, rating, status);
    window.setTimeout(() => this.UnlockRatingView(), Config.animationMs);
  }

  UnlockRatingView() {
    this.State.locked = false;
    this.Render();
  }

  ApplyCommittedDecision(payload, movie) {
    const previous = payload.previous ?? this.State.ratings[movie.ttId] ?? null;
    if (payload.record)
      this.StoreCommittedRating(payload.record, movie.ttId, previous);
    this.AccountRevision = Math.max(this.AccountRevision, Number(payload.stateRevision) || 0);
    this.UpdateActiveMediaPayload({ ratings: { ...this.State.ratings }, history: this.State.history.slice(-200) });
    this.ApplyRaterQueueSnapshot(payload.queue);
    this.UpdateStats();
    this.UpdateSyncView();
  }

  StoreCommittedRating(record, ttId, previous) {
    this.State.ratings[ttId] = record;
    const last = this.State.history.at(-1);
    if (last?.ttId !== ttId)
      this.State.history.push({ ttId, previous });
  }

  async RecoverFromDecisionError(error) {
    if (error?.payload?.current)
      this.ApplyRaterQueueSnapshot(error.payload.current);
    await this.RefreshRemoteState().catch(() => null);
    this.State.locked = false;
    this.Render();
    const message = error.message || "The active title changed on another device.";
    this.ShowToast(`<strong>Queue synchronized:</strong> ${EscapeHtml(message)}`);
  }

  AnimateActiveCard(status) {
    const card = this.Elements.strip.firstElementChild;
    if (!card)
      return;
    this.Elements.strip.classList.add("rating");
    card.classList.remove("active");
    card.classList.add("leaving", status === "notSeen" ? "skip" : RatedStatus);
  }

  ShowRatingToast(movie, rating, status) {
    const unwatchedLabel = this.State.mediaType === "tv" ? "not watched" : "not seen";
    const value = status === RatedStatus ? rating : unwatchedLabel;
    this.ShowToast(`${EscapeHtml(movie.title)} <strong>${value}</strong>`);
  }

  async AddActiveMovieToWishlist(button) {
    if (!this.CanAddActiveTitleToWishlist())
      return false;
    const originalLabel = this.BeginWishlistSave(button);
    const movie = this.State.queue[0];
    const request = this.BuildWishlistRequest(movie);
    const operation = this.RequestJson(Config.raterDecisionUrl, PutMethod, request);
    const saved = operation.then((payload) => this.CompleteWishlistSave(payload, movie));
    const recovered = saved.catch((error) => this.RecoverWishlistSave(error));
    return await recovered.finally(() => this.EndWishlistSave(button, originalLabel));
  }

  CanAddActiveTitleToWishlist() {
    const hasActiveTitle = this.State.queue.length > 0;
    return !this.State.locked && hasActiveTitle;
  }

  BeginWishlistSave(button) {
    this.State.locked = true;
    button.disabled = true;
    button.classList.add(SavingClass);
    const originalLabel = button.innerHTML;
    button.textContent = "Adding...";
    return originalLabel;
  }

  BuildWishlistRequest(movie) {
    return {
      mediaType: this.State.mediaType,
      actionId: this.NewActionId(),
      expectedRevision: this.State.queueRevision,
      kind: "wishlist",
      titleId: movie.ttId,
      title: movie.title,
      year: movie.year || "",
      genres: Array.isArray(movie.genres) ? movie.genres : []
    };
  }

  CompleteWishlistSave(payload, movie) {
    this.State.recommendationQueue = this.NormalizeRecommendationQueue(payload.recommendations);
    this.ApplyRaterQueueSnapshot(payload.queue);
    this.RenderRecommendationQueue();
    this.UpdateRecommendationStatus();
    this.Render();
    const message = payload.duplicate ? "is already in your wishlist" : "added to your wishlist";
    this.ShowToast(`<strong>${EscapeHtml(movie.title)}</strong> ${message}`);
    return true;
  }

  async RecoverWishlistSave(error) {
    if (error?.payload?.current)
      this.ApplyRaterQueueSnapshot(error.payload.current, true);
    await this.RefreshRemoteState().catch(() => null);
    throw error;
  }

  EndWishlistSave(button, originalLabel) {
    this.State.locked = false;
    button.disabled = false;
    button.classList.remove(SavingClass);
    button.innerHTML = originalLabel;
  }

  EnqueueLiveSubmit(ttId, mediaType = this.State.mediaType) {
    const record = this.ReadRatingRecord(ttId, mediaType);
    if (!CanSubmitLive(record, this.State.live.configured))
      return false;
    record.submitStatus = "pending";
    record.submitError = "";
    const queued = this.QueueSubmitId(ttId, mediaType);
    this.UpdateStats();
    this.PumpSubmitQueue();
    return queued;
  }

  ReadRatingRecord(ttId, mediaType = this.State.mediaType) {
    if (mediaType === this.State.mediaType)
      return this.State.ratings[ttId];
    return ReadMediaPayload(this.AccountPayload, mediaType).ratings?.[ttId];
  }

  SubmitKey(ttId, mediaType = this.State.mediaType) {
    return `${mediaType}:${ttId}`;
  }

  QueueSubmitId(ttId, mediaType = this.State.mediaType) {
    const key = this.SubmitKey(ttId, mediaType);
    const isQueued = this.SubmitQueuedIds.has(key);
    const isSubmitting = this.SubmitActiveIds.has(key);
    if (isQueued || isSubmitting)
      return false;
    this.SubmitQueue.push({ ttId, mediaType, key });
    this.SubmitQueuedIds.add(key);
    return true;
  }

  async PumpSubmitQueue() {
    if (this.SubmitInFlight || !this.SubmitQueue.length)
      return;
    const item = this.PopSubmitId();
    const record = this.ReadRatingRecord(item.ttId, item.mediaType);
    if (!CanSubmitLive(record, this.State.live.configured))
      return this.PumpSubmitQueue();
    await this.SubmitRatingRecord(record, item.mediaType);
  }

  PopSubmitId() {
    const item = this.SubmitQueue.shift();
    this.SubmitQueuedIds.delete(item.key);
    return item;
  }

  async SubmitRatingRecord(record, mediaType = this.State.mediaType) {
    const key = this.BeginSubmitAttempt(record.ttId, mediaType);
    const operation = this.PostLiveRating({ ...record, mediaType });
    const submitted = operation.then((result) => this.CompleteSubmitSuccess(record, result, mediaType));
    await submitted.catch((error) => this.CompleteSubmitFailure(record.ttId, error, mediaType));
    this.CompleteSubmitAttempt(key);
  }

  CompleteSubmitSuccess(record, result, mediaType) {
    const rating = result.rating ?? record.rating;
    this.MarkSubmitSuccess(record.ttId, rating, result.revision, mediaType);
  }

  BeginSubmitAttempt(ttId, mediaType) {
    this.SetSubmitInFlight(true);
    const key = this.SubmitKey(ttId, mediaType);
    this.SubmitActiveIds.add(key);
    return key;
  }

  CompleteSubmitFailure(ttId, error, mediaType) {
    const message = error.message || "IMDb submit failed.";
    this.MarkSubmitFailure(ttId, message, mediaType);
    if (/cookie|sign.?in|auth/i.test(error.message || ""))
      this.RequireImdbSignIn();
  }

  CompleteSubmitAttempt(key) {
    this.SubmitActiveIds.delete(key);
    this.UpdateSyncView();
    this.ScheduleNextSubmit();
  }

  SetSubmitInFlight(value) {
    this.SubmitInFlight = value;
    this.State.live.submitting = value;
    this.UpdateStats();
  }

  async PostLiveRating(record) {
    return await this.PostJson(Config.rateUrl, this.BuildLiveRateRequest(record), "IMDb write failed.");
  }

  BuildLiveRateRequest(record) {
    return BuildRateRequest({ ...record, mediaType: record?.mediaType || this.State.mediaType });
  }

  MarkSubmitSuccess(ttId, rating, revision = 0, mediaType = this.State.mediaType) {
    const current = this.ReadRatingRecord(ttId, mediaType);
    if (!current)
      return;
    this.SetSubmittedRating(current, rating);
    this.AccountRevision = Math.max(this.AccountRevision, Number(revision) || 0);
    this.PersistRatingRecord(ttId, mediaType, current);
    if (mediaType === this.State.mediaType)
      this.UpdateSyncView();
  }

  SetSubmittedRating(record, rating) {
    record.submitStatus = "submitted";
    record.submitError = "";
    record.submittedAt = new Date().toISOString();
    record.imdbEchoRating = rating;
  }

  MarkSubmitFailure(ttId, error, mediaType = this.State.mediaType) {
    const current = this.ReadRatingRecord(ttId, mediaType);
    if (!current)
      return;
    current.submitStatus = FailedSubmitStatus;
    current.submitError = error;
    current.submittedAt = "";
    this.PersistRatingRecord(ttId, mediaType, current);
    this.SaveLocalState();
    if (mediaType === this.State.mediaType)
      this.UpdateSyncView();
  }

  PersistRatingRecord(ttId, mediaType, record) {
    const media = ReadMediaPayload(this.AccountPayload, mediaType);
    const ratings = { ...(media.ratings || {}), [ttId]: record };
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, mediaType, { ...media, ratings });
  }

  ScheduleNextSubmit() {
    window.setTimeout(() => this.ContinueSubmitQueue(), Config.submitDelayMs);
  }

  ContinueSubmitQueue() {
    this.SetSubmitInFlight(false);
    this.PumpSubmitQueue();
  }

  RetryImdbFailures() {
    if (!this.State.live.configured)
      return this.RequireImdbSignIn();
    const queued = this.QueueRetryableImdbSubmits();
    this.ShowToast(`Queued <strong>${FormatCount(queued)}</strong> IMDb retries`);
    this.SaveLocalState();
    this.UpdateStats();
  }

  QueueRetryableImdbSubmits() {
    let queued = 0;
    for (const record of Object.values(this.State.ratings)) {
      if (!IsRetryableImdbSubmit(record))
        continue;
      if (this.EnqueueLiveSubmit(record.ttId))
        queued++;
    }
    return queued;
  }

  RequireImdbSignIn() {
    if (this.State.live.configured)
      return;
    this.ShowImdbDialog();
  }
}
