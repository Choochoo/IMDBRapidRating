import { Config } from "../config.js";
import { RenderCard, UpdateActors, UpdatePoster, UpdateRecommendationPoster, UpdateSeriesDetails, UpdateStreamingAvailability, UpdateSynopsis, UpdateTrailerLink } from "../rendering.js";
import { CountRatings } from "../stats.js";

const MissingSynopsis = "To see the synopsis, set up a TMDB key.";
const StreamingRefreshAttempts = new Map();
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
      this.EnrichTitleMetadata(movie.ttId);
  }

  EnrichTitleMetadata(ttId) {
    if (!/^tt\d+$/.test(ttId || ""))
      return;
    if (this.State.metadata[ttId])
      return this.ApplyTitleMetadata(ttId, this.State.metadata[ttId]);
    if (!this.MetadataInFlight.has(ttId))
      this.QueueMetadataRequest(ttId);
  }

  QueueMetadataRequest(ttId) {
    this.MetadataInFlight.add(ttId);
    this.FetchAndApplyMetadata(ttId);
  }

  async FetchAndApplyMetadata(ttId) {
    const metadata = await this.FetchTitleMetadata(ttId).catch(() => this.BuildMissingMetadata());
    this.ApplyTitleMetadata(ttId, metadata);
    this.MetadataInFlight.delete(ttId);
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

  async FetchTitleMetadata(ttId) {
    const payload = await this.FetchJson(this.MediaUrl(`${Config.titleMetadataUrl}${ttId}`), {});
    if (!payload.ok)
      throw new Error(payload.error || "Metadata request failed.");
    return this.BuildTitleMetadata(payload);
  }

  BuildTitleMetadata(payload) {
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
      source: payload.source || ""
    };
  }

  ApplyTitleMetadata(ttId, metadata) {
    this.State.metadata[ttId] = metadata;
    const selector = this.BuildTitleSelector(ttId);
    const card = this.Elements.strip.querySelector(selector);
    if (card)
      this.ApplyCardMetadata(card, ttId, metadata);
    this.ApplyRecommendationMetadata(selector, metadata);
    this.ScheduleStreamingRefresh(ttId, metadata.streamingAvailability);
  }

  ScheduleStreamingRefresh(ttId, availability) {
    if (!availability?.refreshing)
      return StreamingRefreshAttempts.delete(ttId);
    const attempt = (StreamingRefreshAttempts.get(ttId) || 0) + 1;
    if (attempt > MaximumStreamingRefreshAttempts)
      return;
    StreamingRefreshAttempts.set(ttId, attempt);
    this.QueueStreamingRefresh(ttId, StreamingRefreshDelayMilliseconds * attempt);
  }

  QueueStreamingRefresh(ttId, delay) {
    globalThis.setTimeout(() => this.RefreshStreamingMetadata(ttId), delay);
  }

  async RefreshStreamingMetadata(ttId) {
    const metadata = await this.FetchTitleMetadata(ttId).catch(() => null);
    if (metadata)
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
    for (const recommendation of this.Elements.recommendationGrid.querySelectorAll(selector)) {
      UpdateRecommendationPoster(recommendation, metadata);
      UpdateTrailerLink(recommendation, metadata);
    }
  }
}
