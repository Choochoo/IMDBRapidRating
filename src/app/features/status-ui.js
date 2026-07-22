import { BuildAiPreferenceProfile } from "../rating-records.js";
import { RenderFailure, RenderModelOptions } from "../rendering.js";
import { CountRatings } from "../stats.js";
import { FormatCount } from "../util.js";
import { ReadMediaPayload } from "../../../shared/media.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";

const ReadyTone = "ready";
const CheckingTone = "checking";
const AttentionTone = "attention";
const IssueTone = "issue";
const ReadyLabel = "Ready";
const CheckingLabel = "Checking…";
const TvMediaType = "tv";
const MovieMediaType = "movie";
const TvDisplayName = "TV";
const BothRecommendationBasis = "both";
const OtherRecommendationBasis = "other";
const ConnectedLabel = "Connected";
const LoadingLabel = "Loading";
const AriaLabelAttribute = "aria-label";

export class StatusUiFeature {
  UpdateStats() {
    const counts = CountRatings(this.State.ratings);
    this.Elements.rated.textContent = FormatCount(counts.rated);
    this.Elements.skipped.textContent = FormatCount(counts.skipped);
    this.Elements.imported.textContent = FormatCount(counts.imported);
    this.Elements.sent.textContent = FormatCount(counts.sent);
    this.Elements.failed.textContent = FormatCount(counts.failed);
    this.UpdatePoolStatus();
    this.UpdateLiveBadge(counts);
    this.UpdateFailurePanel();
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
      return this.BuildStatusDescriptor(AttentionTone, `${FormatCount(counts.pending)} pending`, "The connection is working and ratings are still being sent.");
    if (this.State.live.dryRun)
      return this.BuildStatusDescriptor(AttentionTone, "Dry run", "Live writes are configured in dry-run mode and will not change IMDb.");
    return this.BuildStatusDescriptor(ReadyTone, ReadyLabel, "New ratings will be sent directly to IMDb.");
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

  UpdateConnectionSummary(counts = CountRatings(this.State.ratings)) {
    const status = this.BuildConnectionSummaryStatus(counts);
    this.ApplyConnectionSummaryStatus(status);
  }

  BuildConnectionSummaryStatus(counts) {
    if (!this.State.live.checked)
      return this.BuildStatusDescriptor(CheckingTone, "Checking", "Connections are still being checked. Open for details.");
    const failed = Number(counts?.failed) || 0;
    const hasIssue = !this.State.live.configured || failed > 0;
    if (hasIssue)
      return this.BuildStatusDescriptor(IssueTone, "Fix needed", "A required connection needs attention. Open for details.");
    if (this.NeedsConnectionAttention(counts))
      return this.BuildStatusDescriptor(AttentionTone, "Attention", "A connection or background task needs attention. Open for details.");
    return this.BuildStatusDescriptor(ReadyTone, ConnectedLabel, "Everything is connected and ready. Open for details.");
  }

  NeedsConnectionAttention(counts) {
    const lacksMetadata = !this.State.live.tmdbConfigured;
    const catalogUnavailable = !this.State.sourceLabel || !this.State.queueReady;
    const hasPendingRatings = Number(counts?.pending) > 0;
    const hasBackgroundWork = hasPendingRatings || this.State.live.submitting;
    return lacksMetadata || catalogUnavailable || this.State.live.dryRun || hasBackgroundWork;
  }

  ApplyConnectionSummaryStatus(status) {
    this.Elements.connectionSummary.classList.remove("connection-ready", "connection-attention", "connection-issue", "connection-checking");
    this.Elements.connectionSummary.classList.add(`connection-${status.tone}`);
    this.Elements.connectionSummaryLabel.textContent = status.text;
    this.Elements.connectionSummary.title = status.tooltip;
    this.Elements.connectionSummary.setAttribute(AriaLabelAttribute, `Connection: ${status.text}. ${status.tooltip}`);
  }

  UpdateRetryButtons(counts) {
    const disabled = !this.State.live.configured || counts.retryableImdb === 0;
    this.Elements.retryFailed.disabled = disabled;
    this.Elements.failureRetry.disabled = disabled;
  }

  UpdateAiControls() {
    this.Elements.configureAi.textContent = this.State.ai.configured ? "OpenAI connected" : "Set OpenAI Key";
    this.SetAiControlsDisabled(this.State.ai.loading);
    this.UpdateModelFeed();
    this.UpdateRecommendationStatus();
  }

  UpdateRecommendationStatus() {
    if (!this.State.ai.configured)
      return this.SetRecommendationStatus("Add an OpenAI API key to generate recommendations.");
    const saved = this.State.recommendationQueue.length;
    const queue = saved ? ` ${FormatCount(saved)} saved ${saved === 1 ? "pick" : "picks"} in your watchlist.` : "";
    this.SetRecommendationStatus(`Ready with ${this.ReadAiModelLabel()}.${queue}`);
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
      outputName: isTv ? "TV shows" : "movies",
      pickName: isTv ? TvDisplayName : MovieMediaType
    };
  }

  UpdateRecommendationBasisLabels(context, basis) {
    const optionLabels = {
      current: `My ${context.currentName} ratings`,
      other: `My ${context.otherName} ratings`,
      [BothRecommendationBasis]: "Both"
    };
    for (const option of this.Elements.recommendationBasis.options)
      option.textContent = optionLabels[option.value] || option.textContent;
    this.Elements.recommendationBasis.value = basis;
    this.Elements.recommendationBasisLabel.textContent = `Build ${context.pickName} picks from`;
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
