import { Config } from "../config.js";
import { BuildAiPreferenceProfile } from "../rating-records.js";
import { RenderRecommendationCard, RenderRecommendationDetails, RenderRecommendationEmpty, RenderRecommendationFilteredEmpty, RenderRecommendationSkeletons } from "../rendering.js";
import { EscapeHtml, FormatCount } from "../util.js";
import { ReadMediaPayload } from "../../../shared/media.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";
import { IsTitleAllowed } from "../../../shared/title-filters.js";

const CurrentRecommendationBasis = "current";
const AiLoadingClass = "is-loading";
const AriaBusyAttribute = "aria-busy";
const MovieMediaType = "movie";
const NormalizedTitleSpace = " ";
const OtherRecommendationBasis = "other";
const PluralPickLabel = "picks";
const RecommendationLoadingMessages = Object.freeze(["Reading the signals in your ratings...", "Finding patterns across genres and eras...", "Comparing stories, directors, and hidden gems...", "Narrowing the list to your strongest matches...", "Giving the final picks a last look..."]);
const SingularPickLabel = "pick";
const TvMediaType = "tv";

export class RecommendationFeature {
  async GenerateRecommendations() {
    if (!this.State.ai.configured)
      return this.ShowAiDialog();
    const count = this.ReadRecommendationCount();
    const mediaType = this.State.mediaType;
    this.PendingRecommendationCount = count;
    this.SetAiLoading(true, count);
    const payload = await this.RequestRecommendations(count).finally(() => this.SetAiLoading(false, count));
    if (mediaType !== this.State.mediaType)
      return;
    this.RenderRecommendations(payload);
  }

  ReadRecommendationCount() {
    const count = Number(this.Elements.recommendationCount.value);
    const isWholeNumber = Number.isInteger(count);
    const isInRange = count >= 1 && count <= 99;
    if (!isWholeNumber || !isInRange)
      throw new Error("Choose a whole number from 1 to 99 for the number of picks.");
    return count;
  }

  async RequestRecommendations(count) {
    return await this.PostJson(Config.recommendationsUrl, await this.BuildRecommendationRequest(count), "AI recommendation request failed.");
  }

  async BuildRecommendationRequest(count = this.ReadRecommendationCount()) {
    const mediaType = this.State.mediaType;
    const basis = NormalizeRecommendationBasis(this.State.recommendationBasis).source;
    const targetProfile = BuildAiPreferenceProfile(this.State.ratings, this.State.movieById, this.State.recommendationExclusions);
    const tasteRatings = await this.BuildTasteRatings(basis, mediaType, targetProfile);
    const profile = this.BuildRecommendationProfile(targetProfile, basis, tasteRatings);
    return {
      count,
      mediaType,
      profile
    };
  }

  async BuildTasteRatings(basis, mediaType, targetProfile) {
    const tasteRatings = [];
    if (basis !== OtherRecommendationBasis)
      tasteRatings.push(...this.TagTasteRatings(targetProfile.ratings, mediaType));
    if (basis === CurrentRecommendationBasis)
      return tasteRatings;
    const otherMediaType = mediaType === TvMediaType ? MovieMediaType : TvMediaType;
    const otherProfile = await this.BuildOtherPreferenceProfile(otherMediaType);
    tasteRatings.push(...this.TagTasteRatings(otherProfile.ratings, otherMediaType));
    return tasteRatings;
  }

  async BuildOtherPreferenceProfile(mediaType) {
    const media = ReadMediaPayload(this.AccountPayload, mediaType);
    const ratings = media.ratings || {};
    if (!Object.keys(ratings).length)
      return BuildAiPreferenceProfile(ratings, new Map());
    const catalog = await this.EnsureCatalog(mediaType);
    return BuildAiPreferenceProfile(ratings, catalog.movieById);
  }

  BuildRecommendationProfile(targetProfile, basis, tasteRatings) {
    return {
      ...targetProfile,
      ratings: tasteRatings,
      ratedTargets: targetProfile.ratings.map(({ title, year }) => ({ title, year })),
      tasteBasis: basis,
      fieldsSent: [...targetProfile.fieldsSent, "sourceMediaType", "ratedTargetTitle", "ratedTargetYear", "tasteBasis"]
    };
  }

  TagTasteRatings(ratings, mediaType) {
    return ratings.map((rating) => ({ ...rating, sourceMediaType: mediaType }));
  }

  AddRecommendationExclusion(value) {
    const exclusion = this.NormalizeRecommendationExclusion(value);
    if (!exclusion)
      return null;
    this.StoreRecommendationExclusion(exclusion);
    this.RemoveRecommendationFromQueue(exclusion);
    this.SaveLocalState();
    this.PersistRecommendationExclusion(exclusion);
    return exclusion;
  }

  StoreRecommendationExclusion(exclusion) {
    const key = this.RecommendationExclusionKey(exclusion);
    const others = this.State.recommendationExclusions.filter((item) => this.RecommendationExclusionKey(item) !== key);
    this.State.recommendationExclusions = [...others, exclusion];
  }

  PersistRecommendationExclusion(exclusion) {
    this.RequestJson(Config.recommendationExclusionsUrl, "PUT", exclusion, { keepalive: true }).catch((error) => this.ShowToast(`<strong>Don't recommend was not saved:</strong> ${EscapeHtml(error.message)}`));
  }

  NormalizeRecommendationExclusions(value) {
    const exclusions = Array.isArray(value) ? value : [];
    const normalized = new Map();
    for (const item of exclusions) {
      const exclusion = this.NormalizeRecommendationExclusion(item);
      if (exclusion)
        normalized.set(this.RecommendationExclusionKey(exclusion), exclusion);
    }
    return [...normalized.values()];
  }

  NormalizeRecommendationExclusion(value) {
    const ttId = this.ReadRecommendationTtId(value);
    const movie = this.State.movieById.get(ttId) || {};
    const title = this.ReadRecommendationTitle(value, movie);
    if (!title)
      return null;
    const year = Number(value?.year || movie.year) || null;
    return this.BuildNormalizedRecommendationExclusion(value, ttId, title, year);
  }

  BuildNormalizedRecommendationExclusion(value, ttId, title, year) {
    return {
      ttId,
      mediaType: this.State.mediaType,
      title,
      year,
      at: String(value?.at || new Date().toISOString()),
      queueKey: this.RecommendationExclusionKey({ title, year })
    };
  }

  ReadRecommendationTtId(value) {
    const ttId = String(value?.ttId || "").trim();
    return /^tt\d+$/.test(ttId) ? ttId : "";
  }

  ReadRecommendationTitle(value, movie = {}) {
    return String(value?.title || movie.title || "").replace(/\s+/g, NormalizedTitleSpace).trim();
  }

  RecommendationExclusionKey(value) {
    const title = this.NormalizeRecommendationTitleKey(value?.title);
    return `${title}|${Number(value?.year) || ""}`;
  }

  NormalizeRecommendationTitleKey(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, NormalizedTitleSpace).trim();
  }

  async RefreshAiModels() {
    if (!this.State.ai.configured)
      return;
    const payload = await this.FetchJson(Config.aiModelsUrl, {});
    this.ApplyAiModelFeed(payload);
  }

  ApplyAiModelFeed(payload) {
    this.State.ai.model = payload.explicitModel || "";
    this.State.ai.selectedModel = payload.selectedModel || "";
    this.State.ai.models = Array.isArray(payload.models) ? payload.models : [];
    this.State.ai.modelLag = Number(payload.modelLag) || this.State.ai.modelLag;
    this.UpdateAiControls();
  }

  SetAiLoading(value, count = this.PendingRecommendationCount) {
    this.State.ai.loading = value;
    this.SetAiControlsDisabled(value);
    this.Elements.generateRecommendations.textContent = this.BuildAiLoadingButtonText(value);
    this.Elements.recommendationLoading.hidden = !value;
    window.clearInterval(this.AiLoadingTimer);
    if (!value)
      return this.StopAiLoading();
    this.StartAiLoading(count);
  }

  BuildAiLoadingButtonText(value) {
    if (!value)
      return "Generate picks";
    const mediaLabel = this.State.mediaType === TvMediaType ? "shows" : "movies";
    return `Finding ${mediaLabel}...`;
  }

  StopAiLoading() {
    this.AiLoadingTimer = 0;
  }

  StartAiLoading(count) {
    this.AiLoadingMessageIndex = 0;
    this.UpdateAiLoadingMessage();
    this.Elements.recommendationGrid.classList.add(AiLoadingClass);
    this.Elements.recommendationGrid.setAttribute(AriaBusyAttribute, "true");
    this.RenderRecommendationLoadingSkeletons(count);
    this.SetRecommendationLoadingStatus(count);
    this.AiLoadingTimer = window.setInterval(() => this.AdvanceAiLoadingMessage(), 1800);
  }

  RenderRecommendationLoadingSkeletons(count) {
    if (this.State.recommendationQueue.length)
      return;
    this.Elements.recommendationGrid.innerHTML = RenderRecommendationSkeletons(Math.min(count, 12));
  }

  SetRecommendationLoadingStatus(count) {
    const label = this.ReadRecommendationPickLabel(count);
    this.SetRecommendationStatus(`Generating ${FormatCount(count)} new ${label} for your saved watchlist.`);
  }

  ReadRecommendationPickLabel(count) {
    return count === 1 ? SingularPickLabel : PluralPickLabel;
  }

  AdvanceAiLoadingMessage() {
    this.AiLoadingMessageIndex = (this.AiLoadingMessageIndex + 1) % RecommendationLoadingMessages.length;
    this.UpdateAiLoadingMessage();
  }

  UpdateAiLoadingMessage() {
    this.Elements.recommendationLoadingCopy.textContent = RecommendationLoadingMessages[this.AiLoadingMessageIndex];
  }

  RenderRecommendations(payload) {
    this.State.recommendationQueue = this.NormalizeRecommendationQueue(payload.recommendations);
    const ratingQueueChanged = this.RemoveWishlistedMoviesFromRatingQueue();
    const added = Number(payload.addedCount) || 0;
    const total = this.State.recommendationQueue.length;
    const summary = payload.summary ? ` ${payload.summary}` : "";
    const label = this.ReadRecommendationPickLabel(added);
    this.SetRecommendationStatus(`Added ${FormatCount(added)} new ${label}. ${FormatCount(total)} saved in your watchlist.${summary}`);
    this.RenderRecommendationQueue();
    if (ratingQueueChanged)
      this.Render();
  }

  RenderRecommendationQueue() {
    this.ResetRecommendationDetails();
    const items = this.ReadVisibleRecommendations();
    this.Elements.recommendationGrid.classList.remove(AiLoadingClass);
    this.Elements.recommendationGrid.setAttribute(AriaBusyAttribute, "false");
    this.Elements.recommendationGrid.innerHTML = this.BuildRecommendationQueueHtml(items);
    this.UpdateRecommendationLibraryCount(items.length);
    for (const item of items)
      this.EnrichTitleMetadata(item.ttId);
  }

  ReadVisibleRecommendations() {
    const visible = this.State.recommendationQueue.filter((item) => IsTitleAllowed(item, this.State.filters));
    return this.SortRecommendations(visible);
  }

  BuildRecommendationQueueHtml(items) {
    if (items.length)
      return this.BuildRecommendationCards(items);
    if (this.State.recommendationQueue.length)
      return RenderRecommendationFilteredEmpty();
    return RenderRecommendationEmpty();
  }

  BuildRecommendationCards(items) {
    return items.map((item, index) => RenderRecommendationCard(item, index)).join("");
  }

  SortRecommendations(items) {
    return [...items].sort((left, right) => this.CompareRecommendations(left, right));
  }

  CompareRecommendations(left, right) {
    const comparison = this.CompareRecommendationField(left, right);
    if (!comparison)
      return this.CompareRecommendationTitles(left, right);
    return this.RecommendationSortDescending ? -comparison : comparison;
  }

  CompareRecommendationField(left, right) {
    const field = this.Elements.recommendationSort.value;
    if (field === "title")
      return this.CompareRecommendationTitles(left, right);
    const leftValue = this.ReadRecommendationSortNumber(left, field);
    const rightValue = this.ReadRecommendationSortNumber(right, field);
    return leftValue - rightValue;
  }

  ReadRecommendationSortNumber(item, field) {
    if (field === "year")
      return Number(item?.year) || 0;
    if (field === "imdbRating")
      return Number(item?.imdbRating) || 0;
    const timestamp = Date.parse(String(item?.addedAt || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  CompareRecommendationTitles(left, right) {
    return String(left?.title || "").localeCompare(String(right?.title || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  HandleRecommendationSortChange() {
    this.RecommendationSortDescending = this.Elements.recommendationSort.value !== "title";
    this.UpdateRecommendationSortDirection();
    this.RenderRecommendationQueue();
  }

  ToggleRecommendationSortDirection() {
    this.RecommendationSortDescending = !this.RecommendationSortDescending;
    this.UpdateRecommendationSortDirection();
    this.RenderRecommendationQueue();
  }

  UpdateRecommendationSortDirection() {
    const label = this.RecommendationSortDescending ? "Sort descending" : "Sort ascending";
    this.Elements.recommendationSortDirection.textContent = this.RecommendationSortDescending ? "↓" : "↑";
    this.Elements.recommendationSortDirection.setAttribute("aria-label", label);
    this.Elements.recommendationSortDirection.title = label;
  }

  UpdateRecommendationLibraryCount(visibleCount) {
    const savedCount = this.State.recommendationQueue.length;
    const label = visibleCount === savedCount ? `${FormatCount(savedCount)} saved` : `${FormatCount(visibleCount)} of ${FormatCount(savedCount)}`;
    this.Elements.watchlistCount.textContent = label;
  }

  ShowRecommendationDetails(button) {
    const item = this.FindRecommendationFromElement(button);
    if (!item)
      return;
    this.RecommendationDetailTrigger = button;
    this.Elements.recommendationDetailsContent.innerHTML = RenderRecommendationDetails(item);
    this.Elements.recommendationDetails.hidden = false;
    this.EnrichTitleMetadata(item.ttId);
    this.Elements.recommendationDetailsClose.focus();
  }

  FindRecommendationFromElement(element) {
    const container = element?.closest?.("[data-recommendation-item]");
    if (!container)
      return null;
    const value = { ttId: container.dataset.ttid, title: container.dataset.title, year: container.dataset.year };
    return this.State.recommendationQueue.find((item) => this.IsSameRecommendation(item, value)) || null;
  }

  HideRecommendationDetails() {
    const trigger = this.RecommendationDetailTrigger;
    this.ResetRecommendationDetails();
    trigger?.focus?.();
  }

  ResetRecommendationDetails() {
    this.Elements.recommendationDetails.hidden = true;
    this.Elements.recommendationDetailsContent.innerHTML = "";
    this.RecommendationDetailTrigger = null;
  }

  async RefreshRecommendationQueue(options = {}) {
    if (this.State.ai.loading && !options.force)
      return false;
    const payload = await this.FetchJson(this.MediaUrl(Config.recommendationQueueUrl));
    const queue = this.NormalizeRecommendationQueue(payload.recommendations);
    if (!this.ShouldRefreshRecommendationQueue(queue, options.force))
      return false;
    this.ApplyRecommendationQueue(queue);
    if (!options.silent)
      this.ShowToast("Your saved recommendation watchlist was updated.");
    return true;
  }

  ShouldRefreshRecommendationQueue(queue, force) {
    if (force)
      return true;
    const previous = this.RecommendationQueueSignature(this.State.recommendationQueue);
    const next = this.RecommendationQueueSignature(queue);
    return previous !== next;
  }

  ApplyRecommendationQueue(queue) {
    this.State.recommendationQueue = queue;
    const ratingQueueChanged = this.RemoveWishlistedMoviesFromRatingQueue();
    this.RenderRecommendationQueue();
    this.UpdateRecommendationStatus();
    if (ratingQueueChanged)
      this.Render();
  }

  NormalizeRecommendationQueue(value) {
    const normalized = [];
    for (const item of Array.isArray(value) ? value : []) {
      const recommendation = this.NormalizeRecommendationQueueItem(item);
      if (!recommendation)
        continue;
      if (!normalized.some((existing) => this.IsSameRecommendation(existing, recommendation)))
        normalized.push(recommendation);
    }
    return normalized;
  }

  NormalizeRecommendationQueueItem(item) {
    const title = this.ReadRecommendationTitle(item);
    if (!title)
      return null;
    const year = Number(item?.year) || null;
    return {
      ...item,
      ttId: this.ReadRecommendationTtId(item),
      title,
      year,
      queueKey: String(item?.queueKey || this.RecommendationExclusionKey({ title, year }))
    };
  }

  RemoveRecommendationFromQueue(value) {
    const previousLength = this.State.recommendationQueue.length;
    this.State.recommendationQueue = this.State.recommendationQueue.filter((item) => !this.IsSameRecommendation(item, value));
    if (this.State.recommendationQueue.length === previousLength)
      return false;
    this.RenderRecommendationQueue();
    this.UpdateRecommendationStatus();
    return true;
  }

  IsSameRecommendation(left, right) {
    if (this.HasMatchingRecommendationIds(left, right))
      return true;
    const leftTitle = this.NormalizeRecommendationTitleKey(left?.title);
    const rightTitle = this.NormalizeRecommendationTitleKey(right?.title);
    if (!leftTitle)
      return false;
    if (leftTitle !== rightTitle)
      return false;
    return this.HasCompatibleRecommendationYears(left?.year, right?.year);
  }

  HasMatchingRecommendationIds(left, right) {
    const leftId = String(left?.ttId || "").trim();
    const rightId = String(right?.ttId || "").trim();
    const hasBothIds = Boolean(leftId && rightId);
    return hasBothIds && leftId === rightId;
  }

  HasCompatibleRecommendationYears(leftValue, rightValue) {
    const leftYear = Number(leftValue) || null;
    const rightYear = Number(rightValue) || null;
    if (!leftYear || !rightYear)
      return true;
    return leftYear === rightYear;
  }

  RecommendationQueueSignature(value) {
    return this.NormalizeRecommendationQueue(value)
      .map((item) => `${item.queueKey}|${item.addedAt || ""}`)
      .join("\n");
  }

  ShowRecommendationError(message) {
    this.SetAiLoading(false);
    this.RenderRecommendationQueue();
    this.SetRecommendationStatus(message || "Could not generate recommendations.");
  }
}
