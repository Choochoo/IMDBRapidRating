import { Config } from "../config.js";
import { MissingSynopsis, RenderCard, UpdateActors, UpdatePoster, UpdateRecommendationPoster, UpdateSeriesDetails, UpdateStreamingAvailability, UpdateSynopsis, UpdateTrailerLink } from "../rendering.js";
import { CountRatings } from "../stats.js";

const StreamingRefreshStates = new Map();
const MaximumStreamingRefreshAttempts = 4;
const StreamingRefreshDelayMilliseconds = 750;

export class CatalogViewFeature {
  Render() {
    this.UpdateStats();
    this.Elements.sourceBadge.textContent = this.State.sourceLabel;
    this.UpdateSourceStatus();
    this.UpdateConnectionSummary(CountRatings(this.State.ratings));
    if (!this.State.queueReady)
      return this.ShowQueueSynchronization();
    if (!this.State.queue.length)
      return this.ShowComplete();
    this.RenderVisibleCards();
  }

  ShowQueueSynchronization() {
    const mediaName = this.State.mediaType === "tv" ? "TV show" : "movie";
    this.Elements.strip.innerHTML = "";
    this.Elements.emptySummary.textContent = `Synchronizing your ${mediaName} queue...`;
    this.Elements.empty.hidden = false;
  }

  RenderVisibleCards() {
    const visible = this.State.queue.slice(0, Config.visibleCount);
    this.Elements.empty.hidden = true;
    this.Elements.strip.classList.remove("rating");
    this.Elements.strip.innerHTML = visible.map((movie, index) => this.BuildCardHtml(movie, index)).join("");
    this.EnrichVisibleMovies(visible);
  }

  BuildCardHtml(movie, index) {
    const metadata = this.State.metadata[movie.ttId] || {};
    return RenderCard(movie, index, metadata);
  }

  EnrichVisibleMovies(movies) {
    for (const movie of movies)
      this.EnrichTitleMetadata(movie.ttId, true);
  }

  EnrichTitleMetadata(ttId, includeStreaming = false) {
    if (!/^tt\d+$/.test(ttId || ""))
      return;
    const cached = this.State.metadata[ttId];
    if (cached && (!includeStreaming || cached.streamingRequested))
      return this.ApplyTitleMetadata(ttId, cached);
    const requestKey = BuildMetadataRequestKey(ttId, includeStreaming);
    if (!this.MetadataInFlight.has(requestKey))
      this.QueueMetadataRequest(ttId, includeStreaming);
  }

  QueueMetadataRequest(ttId, includeStreaming) {
    const requestKey = BuildMetadataRequestKey(ttId, includeStreaming);
    this.MetadataInFlight.add(requestKey);
    this.FetchAndApplyMetadata(ttId, includeStreaming, requestKey);
  }

  async FetchAndApplyMetadata(ttId, includeStreaming, requestKey) {
    const metadata = await this.FetchTitleMetadata(ttId, includeStreaming).catch(() => null);
    if (metadata)
      this.ApplyTitleMetadata(ttId, metadata);
    else if (!this.State.metadata[ttId])
      this.ApplyTitleMetadata(ttId, this.BuildMissingMetadata());
    this.MetadataInFlight.delete(requestKey);
  }

  BuildMissingMetadata() {
    return {
      posterUrl: "",
      synopsis: MissingSynopsis,
      actors: [],
      trailerUrl: "",
      streamingAvailability: null,
      source: ""
    };
  }

  async FetchTitleMetadata(ttId, includeStreaming = false) {
    const suffix = includeStreaming ? "?streaming=1" : "";
    const payload = await this.FetchJson(this.MediaUrl(`${Config.titleMetadataUrl}${ttId}${suffix}`), {});
    if (!payload.ok)
      throw new Error(payload.error || "Metadata request failed.");
    return this.BuildTitleMetadata(payload, includeStreaming);
  }

  BuildTitleMetadata(payload, includeStreaming = false) {
    return {
      posterUrl: payload.posterUrl || "",
      synopsis: payload.synopsis || MissingSynopsis,
      actors: Array.isArray(payload.actors) ? payload.actors.slice(0, 3) : [],
      trailerUrl: payload.trailerUrl || "",
      seriesStatus: payload.seriesStatus || "",
      seasonCount: Number(payload.seasonCount) || 0,
      episodeCount: Number(payload.episodeCount) || 0,
      episodeRuntimeMinutes: Number(payload.episodeRuntimeMinutes) || 0,
      streamingAvailability: payload.streamingAvailability && typeof payload.streamingAvailability === "object" ? payload.streamingAvailability : null,
      streamingRequested: includeStreaming,
      source: payload.source || ""
    };
  }

  ApplyTitleMetadata(ttId, metadata) {
    const applied = PreserveStreamingMetadata(this.State.metadata[ttId], metadata);
    this.State.metadata[ttId] = applied;
    this.ScheduleStreamingRefresh(ttId, applied.streamingAvailability);
    const selector = this.BuildTitleSelector(ttId);
    const card = this.Elements.strip.querySelector(selector);
    if (card)
      this.ApplyCardMetadata(card, ttId, applied);
    this.ApplyRecommendationMetadata(selector, applied);
  }

  ScheduleStreamingRefresh(ttId, availability) {
    if (!availability?.refreshing)
      return this.ClearStreamingRefresh(ttId);
    const state = ReadStreamingRefreshState(ttId);
    if (state.timer || state.inFlight)
      return;
    state.attempts++;
    if (state.attempts > MaximumStreamingRefreshAttempts)
      return this.StopStreamingRefresh(ttId, availability);
    state.timer = this.QueueStreamingRefresh(ttId, StreamingRefreshDelayMilliseconds * state.attempts);
  }

  QueueStreamingRefresh(ttId, delay) {
    return globalThis.setTimeout(() => this.BeginStreamingRefresh(ttId), delay);
  }

  BeginStreamingRefresh(ttId) {
    const state = StreamingRefreshStates.get(ttId);
    if (!state || state.inFlight)
      return;
    state.timer = null;
    state.inFlight = true;
    return this.RefreshStreamingMetadata(ttId, state);
  }

  ClearStreamingRefresh(ttId) {
    const state = StreamingRefreshStates.get(ttId);
    if (state?.timer)
      globalThis.clearTimeout(state.timer);
    StreamingRefreshStates.delete(ttId);
  }

  StopStreamingRefresh(ttId, availability) {
    availability.refreshing = false;
    this.ClearStreamingRefresh(ttId);
  }

  async RefreshStreamingMetadata(ttId, refreshState = ReadStreamingRefreshState(ttId)) {
    const metadata = await this.FetchTitleMetadata(ttId, true).catch(() => null);
    if (StreamingRefreshStates.get(ttId) !== refreshState)
      return;
    refreshState.inFlight = false;
    if (!metadata)
      return this.StopFailedStreamingRefresh(ttId);
    this.ApplyTitleMetadata(ttId, metadata);
  }

  StopFailedStreamingRefresh(ttId) {
    const metadata = this.State.metadata[ttId];
    if (!metadata?.streamingAvailability)
      return this.ClearStreamingRefresh(ttId);
    metadata.streamingAvailability.refreshing = false;
    this.ApplyTitleMetadata(ttId, metadata);
  }

  BuildTitleSelector(ttId) {
    return `[data-ttid="${ttId}"]`;
  }

  ApplyCardMetadata(card, ttId, metadata) {
    UpdatePoster(card, metadata);
    UpdateSynopsis(card, metadata);
    UpdateActors(card, metadata);
    UpdateTrailerLink(card, metadata);
    UpdateSeriesDetails(card, this.State.movieById.get(ttId) || {}, metadata);
    UpdateStreamingAvailability(card, metadata);
  }

  ApplyRecommendationMetadata(selector, metadata) {
    const containers = [this.Elements.recommendationGrid, this.Elements.recommendationDetailsContent];
    for (const container of containers)
      for (const recommendation of container.querySelectorAll(selector)) {
        UpdateRecommendationPoster(recommendation, metadata);
        UpdateTrailerLink(recommendation, metadata);
      }
  }
}

function ReadStreamingRefreshState(ttId) {
  const existing = StreamingRefreshStates.get(ttId);
  if (existing)
    return existing;
  const state = { attempts: 0, timer: null, inFlight: false };
  StreamingRefreshStates.set(ttId, state);
  return state;
}

function BuildMetadataRequestKey(ttId, includeStreaming) {
  return `${ttId}:${includeStreaming ? "streaming" : "metadata"}`;
}

function PreserveStreamingMetadata(current, incoming) {
  if (!current?.streamingRequested || incoming.streamingRequested)
    return incoming;
  return { ...incoming, streamingAvailability: current.streamingAvailability, streamingRequested: true };
}
