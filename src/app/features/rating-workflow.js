import { Config } from "../config.js";
import { BuildRateRequest } from "../rating-records.js";
import { EscapeHtml, FormatCount } from "../util.js";
import { AnalyticsEvents } from "../analytics-events.js";

const RatedStatus = "rated";
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
    this.TrackProductEvent?.(AnalyticsEvents.RatingDecisionCompleted, { decision: status, media_type: this.State.mediaType });
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
    const message = payload.duplicate ? "is already in your watchlist" : "added to your watchlist";
    this.ShowToast(`<strong>${EscapeHtml(movie.title)}</strong> ${message}`);
    this.TrackProductEvent?.(AnalyticsEvents.WatchlistItemAdded, { duplicate: Boolean(payload.duplicate), media_type: this.State.mediaType });
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

  BuildLiveRateRequest(record) {
    return BuildRateRequest({ ...record, mediaType: record?.mediaType || this.State.mediaType });
  }

  async RetryImdbFailures() {
    if (!this.State.live.configured)
      return this.RequireImdbSignIn();
    const result = await this.PostJson(Config.imdbRetryUrl, {});
    await this.RefreshRemoteState();
    this.ShowToast(`Queued <strong>${FormatCount(result.queued)}</strong> IMDb retries`);
    this.UpdateStats();
  }

  RequireImdbSignIn() {
    if (this.State.live.configured)
      return;
    this.ShowImdbDialog();
  }
}
