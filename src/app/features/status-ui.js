import { BuildAiPreferenceProfile } from "../rating-records.js";
import { RenderFailure, RenderModelOptions } from "../rendering.js";
import { CountRatings } from "../stats.js";
import { FormatCount } from "../util.js";
import { ReadMediaPayload } from "../../../shared/media.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";
import { IsTitleAllowed } from "../../../shared/title-filters.js";

const ReadyTone = "ready";
const CheckingTone = "checking";
const AttentionTone = "attention";
const IssueTone = "issue";
const ReadyLabel = "Ready";
const CheckingLabel = "Checking…";
const TvMediaType = "tv";
const MovieMediaType = "movie";
const MovieDisplayName = "Movies";
const TvDisplayName = "TV";
const TvOptionName = "TV Shows";
const BothRecommendationBasis = "both";
const OtherRecommendationBasis = "other";
const ConnectedLabel = "Connected";
const LoadingLabel = "Loading";
const AriaLabelAttribute = "aria-label";

export class StatusUiFeature {
  UpdateStats() {
    const counts = this.BuildDisplayedRatingCounts(CountRatings(this.State.ratings));
    this.Elements.rated.textContent = FormatCount(counts.rated);
    this.Elements.skipped.textContent = FormatCount(counts.skipped);
    this.Elements.imported.textContent = FormatCount(counts.imported);
    this.Elements.sent.textContent = FormatCount(counts.sent);
    this.Elements.failed.textContent = FormatCount(counts.failed);
    this.UpdatePoolStatus();
    this.UpdateLiveBadge(counts);
    this.UpdateFailurePanel();
  }

  BuildDisplayedRatingCounts(counts) {
    const queue = this.State.live.queueCounts || {};
    const failedJobs = Number(queue.failed) || 0;
    const authRequiredJobs = Number(queue.auth_required) || 0;
    const queuedFailures = failedJobs + authRequiredJobs;
    return {
      ...counts,
      pending: Math.max(counts.pending, Number(queue.pending) || 0),
      failed: Math.max(counts.failed, queuedFailures),
      retryableImdb: Math.max(counts.retryableImdb, queuedFailures)
    };
  }

  UpdatePoolStatus() {
    this.Elements.poolStatus.textContent = this.ReadPoolStatus();
  }

  ReadPoolStatus() {
    if (!this.State.queueReady)
      return "Syncing";
    return this.State.queue.length ? ReadyLabel : "Empty";
  }

  UpdateLiveBadge(counts) {
    this.UpdateSettingsButtons();
    this.UpdateRetryButtons(counts);
    const status = this.BuildLiveBadgeStatus(counts);
    this.SetLiveBadge(status.tone, status.text, status.tooltip, counts);
  }

  BuildLiveBadgeStatus(counts) {
    if (!this.State.live.checked)
      return this.BuildStatusDescriptor(CheckingTone, CheckingLabel, "The app is checking the IMDb live rating connection.");
    if (!this.State.live.configured)
      return this.BuildStatusDescriptor(IssueTone, "IMDb connection required", "Connect IMDb before ratings can be sent live.");
    if (counts.failed > 0)
      return this.BuildStatusDescriptor(IssueTone, `${FormatCount(counts.failed)} failed`, "Some ratings were not accepted by IMDb. Use Import / Export to retry them.");
    if (counts.pending > 0 || this.State.live.submitting)
      return this.BuildStatusDescriptor(AttentionTone, `${FormatCount(counts.pending)} pending`, "Ratings are queued for controlled background delivery to IMDb.");
    if (this.State.live.dryRun)
      return this.BuildStatusDescriptor(AttentionTone, "Dry run", "Live writes are configured in dry-run mode and will not change IMDb.");
    return this.BuildStatusDescriptor(ReadyTone, ReadyLabel, "New ratings will be queued and sent to IMDb in the background.");
  }

  BuildStatusDescriptor(tone, text, tooltip) {
    return { tone, text, tooltip };
  }

  SetLiveBadge(tone, text, tooltip, counts) {
    this.Elements.liveBadge.textContent = text;
    this.SetConnectionStatus(this.Elements.liveStatusRow, tone, tooltip, `Live rating sync: ${text}`);
    this.UpdateConnectionSummary(counts);
  }

  UpdateSettingsButtons() {
    this.UpdateImdbButton();
    this.UpdateTmdbButton();
    this.UpdateOpenAiButton();
  }

  UpdateImdbButton() {
    const status = this.BuildImdbButtonStatus();
    this.ApplySettingsButtonStatus(this.Elements.configureImdb, this.Elements.imdbStatusLabel, "IMDb", status);
  }

  BuildImdbButtonStatus() {
    const connectedTooltip = "IMDb is connected. Select this status to update or remove the connection.";
    const missingTooltip = "IMDb is not connected. Select this status to connect live rating writes.";
    const tooltip = this.State.live.configured ? connectedTooltip : missingTooltip;
    if (!this.State.live.checked)
      return this.BuildStatusDescriptor(CheckingTone, CheckingLabel, tooltip);
    if (this.State.live.configured)
      return this.BuildStatusDescriptor(ReadyTone, ConnectedLabel, tooltip);
    return this.BuildStatusDescriptor(IssueTone, "Action required", tooltip);
  }

  UpdateTmdbButton() {
    const status = this.BuildTmdbButtonStatus();
    this.ApplySettingsButtonStatus(this.Elements.configureTmdb, this.Elements.tmdbStatusLabel, "TMDB", status);
  }

  BuildTmdbButtonStatus() {
    const connectedTooltip = "TMDB is ready to supply posters, summaries, cast, and other title details.";
    const missingTooltip = "Add a TMDB key to load posters, summaries, cast, and other title details.";
    const tooltip = this.State.live.tmdbConfigured ? connectedTooltip : missingTooltip;
    if (!this.State.live.checked)
      return this.BuildStatusDescriptor(CheckingTone, CheckingLabel, tooltip);
    if (this.State.live.tmdbConfigured)
      return this.BuildStatusDescriptor(ReadyTone, ReadyLabel, tooltip);
    return this.BuildStatusDescriptor(AttentionTone, "Key needed", tooltip);
  }

  UpdateOpenAiButton() {
    const status = this.BuildOpenAiButtonStatus();
    this.ApplySettingsButtonStatus(this.Elements.configureOpenAi, this.Elements.openAiStatusLabel, "OpenAI", status);
  }

  BuildOpenAiButtonStatus() {
    const connectedTooltip = "OpenAI is ready to generate recommendations from your ratings.";
    const missingTooltip = "Add an OpenAI key to generate recommendations.";
    if (!this.State.ai.checked)
      return this.BuildStatusDescriptor(CheckingTone, CheckingLabel, missingTooltip);
    if (this.State.ai.configured)
      return this.BuildStatusDescriptor(ReadyTone, ReadyLabel, connectedTooltip);
    return this.BuildStatusDescriptor(AttentionTone, "Key needed", missingTooltip);
  }

  ApplySettingsButtonStatus(button, label, prefix, status) {
    label.textContent = status.text;
    this.SetConnectionStatus(button, status.tone, status.tooltip, `${prefix}: ${status.text}`);
  }

  UpdateSourceStatus() {
    const status = this.BuildSourceStatus();
    const label = this.State.sourceLabel || LoadingLabel;
    this.SetConnectionStatus(this.Elements.sourceStatusRow, status.tone, status.tooltip, `Title catalog: ${label}`);
  }

  BuildSourceStatus() {
    if (!this.State.sourceLabel)
      return this.BuildStatusDescriptor(CheckingTone, LoadingLabel, "The title catalog is still loading.");
    if (!this.State.queueReady)
      return this.BuildStatusDescriptor(AttentionTone, this.State.sourceLabel, `${this.State.sourceLabel}. The rating queue is still synchronizing.`);
    return this.BuildStatusDescriptor(ReadyTone, this.State.sourceLabel, `${this.State.sourceLabel}. The rating queue is synchronized and ready.`);
  }

  SetConnectionStatus(element, tone, tooltip, accessibleLabel) {
    element.classList.remove("status-ready", "status-attention", "status-issue", "status-checking");
    element.classList.add(`status-${tone}`);
    element.dataset.tooltip = tooltip;
    element.title = tooltip;
    element.setAttribute(AriaLabelAttribute, accessibleLabel);
  }

  UpdateConnectionSummary() {
    const status = this.BuildConnectionSummaryStatus();
    this.ApplyConnectionSummaryStatus(status);
  }

  BuildConnectionSummaryStatus() {
    if (!this.State.live.checked || !this.State.ai.checked)
      return this.BuildStatusDescriptor(CheckingTone, "Checking connections", "Connections are still being checked. Open for details.");
    const summary = this.ReadConnectionSummary();
    if (summary.connected === 0)
      return this.BuildStatusDescriptor(IssueTone, "0 of 3 connected", summary.tooltip);
    if (summary.connected < summary.total)
      return this.BuildStatusDescriptor(AttentionTone, `${summary.connected} of ${summary.total} connected`, summary.tooltip);
    return this.BuildStatusDescriptor(ReadyTone, "3 of 3 connected", summary.tooltip);
  }

  ReadConnectionSummary() {
    const services = this.ReadConnectionServices();
    const connected = services.filter((service) => service.connected).length;
    const missing = services.filter((service) => !service.connected).map((service) => service.name);
    const tooltip = missing.length ? `${connected} of ${services.length} connected. Missing: ${missing.join(", ")}.` : "All 3 services are connected.";
    return { connected, total: services.length, tooltip };
  }

  ReadConnectionServices() {
    return [
      { name: "IMDb", connected: Boolean(this.State.live.configured) },
      { name: "TMDB", connected: Boolean(this.State.live.tmdbConfigured) },
      { name: "OpenAI", connected: Boolean(this.State.ai.configured) }
    ];
  }

  ApplyConnectionSummaryStatus(status) {
    this.Elements.connectionSummary.classList.remove("connection-ready", "connection-attention", "connection-issue", "connection-checking");
    this.Elements.connectionSummary.classList.add(`connection-${status.tone}`);
    this.Elements.connectionSummaryLabel.textContent = status.text;
    this.Elements.connectionMenuHeading.textContent = `${status.text}. Select a service to manage it.`;
    this.Elements.connectionSummary.title = status.tooltip;
    this.Elements.connectionSummary.setAttribute(AriaLabelAttribute, `Connections: ${status.text}. ${status.tooltip}`);
  }

  UpdateRetryButtons(counts) {
    const disabled = !this.State.live.configured || counts.retryableImdb === 0;
    this.Elements.retryFailed.disabled = disabled;
    this.Elements.failureRetry.disabled = disabled;
  }

  UpdateAiControls() {
    this.Elements.configureAi.textContent = this.State.ai.configured ? "OpenAI connected" : "Set OpenAI Key";
    this.UpdateSettingsButtons();
    this.UpdateConnectionSummary();
    this.SetAiControlsDisabled(this.State.ai.loading);
    this.UpdateModelFeed();
    this.UpdateRecommendationStatus();
  }

  UpdateRecommendationStatus() {
    if (!this.State.ai.configured)
      return this.SetRecommendationStatus("Add an OpenAI API key to generate recommendations.");
    const saved = this.State.recommendationQueue.length;
    const visible = this.State.recommendationQueue.filter((item) => IsTitleAllowed(item, this.State.filters)).length;
    const queue = this.BuildRecommendationQueueStatus(saved, visible);
    this.SetRecommendationStatus(`Ready with ${this.ReadAiModelLabel()}.${queue}`);
  }

  BuildRecommendationQueueStatus(saved, visible) {
    if (!saved)
      return "";
    const label = saved === 1 ? "pick" : "picks";
    if (visible === saved)
      return ` ${FormatCount(saved)} saved ${label} in your watchlist.`;
    return ` ${FormatCount(visible)} of ${FormatCount(saved)} saved ${label} match the active filters.`;
  }

  UpdateRecommendationBasisControl() {
    const context = this.BuildRecommendationMediaContext();
    const basis = NormalizeRecommendationBasis(this.State.recommendationBasis).source;
    this.UpdateRecommendationBasisLabels(context, basis);
    const counts = this.ReadRecommendationBasisCounts(context, basis);
    const sourceCopy = this.BuildRecommendationSourceCopy(context, counts, basis);
    const readiness = this.BuildRecommendationReadiness(sourceCopy, counts.selected);
    this.Elements.recommendationBasisDetail.textContent = `${readiness} Picks, filters, and watchlist stay ${context.outputName}.`;
  }

  BuildRecommendationMediaContext() {
    const isTv = this.State.mediaType === TvMediaType;
    return {
      currentMediaType: isTv ? TvMediaType : MovieMediaType,
      otherMediaType: isTv ? MovieMediaType : TvMediaType,
      currentName: isTv ? TvDisplayName : MovieMediaType,
      otherName: isTv ? MovieMediaType : TvDisplayName,
      currentOption: isTv ? TvOptionName : MovieDisplayName,
      otherOption: isTv ? MovieDisplayName : TvOptionName,
      outputName: isTv ? "TV shows" : "movies",
    };
  }

  UpdateRecommendationBasisLabels(context, basis) {
    const optionLabels = {
      current: context.currentOption,
      other: context.otherOption,
      [BothRecommendationBasis]: "Both"
    };
    for (const option of this.Elements.recommendationBasis.options)
      option.textContent = optionLabels[option.value] || option.textContent;
    this.Elements.recommendationBasis.value = basis;
    this.Elements.recommendationBasisLabel.textContent = "Create from";
  }

  ReadRecommendationBasisCounts(context, basis) {
    const current = this.CountTasteRatings(context.currentMediaType);
    const other = this.CountTasteRatings(context.otherMediaType);
    const selected = this.SelectTasteRatingCount(current, other, basis);
    return { current, other, selected };
  }

  SelectTasteRatingCount(current, other, basis) {
    if (basis === BothRecommendationBasis)
      return current + other;
    if (basis === OtherRecommendationBasis)
      return other;
    return current;
  }

  BuildRecommendationSourceCopy(context, counts, basis) {
    if (basis === BothRecommendationBasis)
      return `${this.FormatTasteRatingCount(counts.current, context.currentName)} and ${this.FormatTasteRatingCount(counts.other, context.otherName)}`;
    const mediaName = basis === OtherRecommendationBasis ? context.otherName : context.currentName;
    return this.FormatTasteRatingCount(counts.selected, mediaName);
  }

  BuildRecommendationReadiness(sourceCopy, selectedCount) {
    if (selectedCount < 5)
      return `You need at least 5 selected ratings; currently using ${sourceCopy}.`;
    return `Using ${sourceCopy} as taste signals.`;
  }

  FormatTasteRatingCount(count, mediaName) {
    return `${FormatCount(count)} ${mediaName} ${count === 1 ? "rating" : "ratings"}`;
  }

  CountTasteRatings(mediaType) {
    if (mediaType === this.State.mediaType)
      return BuildAiPreferenceProfile(this.State.ratings || {}, new Map()).ratings.length;
    const records = ReadMediaPayload(this.AccountPayload, mediaType).ratings;
    return BuildAiPreferenceProfile(records || {}, new Map()).ratings.length;
  }

  SetRecommendationStatus(message) {
    this.Elements.recommendationStatus.textContent = message;
  }

  ReadAiModelLabel() {
    return this.State.ai.selectedModel || this.State.ai.model || "auto model";
  }

  UpdateModelFeed() {
    this.Elements.aiModelStatus.textContent = `Model: ${this.ReadAiModelLabel()}`;
    this.Elements.aiModelDetail.textContent = this.BuildModelDetailText();
    this.UpdateModelSelect();
  }

  BuildModelDetailText() {
    if (this.State.ai.model)
      return "Manual OPENAI_MODEL override is active.";
    return `Auto-selecting ${FormatCount(this.State.ai.modelLag)} versions behind newest eligible GPT model.`;
  }

  UpdateModelSelect() {
    this.Elements.aiModelSelect.innerHTML = RenderModelOptions(this.State.ai);
    this.Elements.aiModelSelect.value = this.State.ai.model || "";
  }

  UpdateFailurePanel() {
    const failures = this.ReadRecentFailures();
    if (!failures.length)
      return this.HideFailurePanel();
    this.Elements.failurePanel.hidden = false;
    this.Elements.failureList.innerHTML = failures.map(RenderFailure).join("");
  }

  ReadRecentFailures() {
    return Object.values(this.State.ratings)
      .filter((record) => record.submitStatus === "failed")
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, 5);
  }

  HideFailurePanel() {
    this.Elements.failurePanel.hidden = true;
    this.Elements.failureList.innerHTML = "";
  }
}
