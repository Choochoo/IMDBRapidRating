import { Config } from "./config.js";
import { ActiveClass, AiSettingsView, AiView, AriaPressedAttribute, BackspaceKey, DeleteKey, FriendsView, ImdbSecretType, MovieDisplayName, MovieMediaType, NoStoreCache, NotSeenLabel, NotWatchedLabel, PostMethod, PressedClass, PutMethod, RaterView, SavingLabel, SettingsView, ShowClass, SyncView, TvDisplayName, TvMediaType, TvShowName, UndoShortcutAction } from "./app-constants.js";
import { InstallFeatureMethods } from "./feature-methods.js";
import { AccountSyncFeature } from "./features/account-sync.js";
import { AiSettingsFeature } from "./features/ai-settings.js";
import { ApplicationLifecycleFeature } from "./features/application-lifecycle.js";
import { CatalogViewFeature } from "./features/catalog-view.js";
import { CollectionSyncFeature } from "./features/collection-sync.js";
import { DataTransferFeature } from "./features/data-transfer.js";
import { EventBindingsFeature } from "./features/event-bindings.js";
import { FriendsFeature } from "./features/friends.js";
import { HelpRemindersFeature } from "./features/help-reminders.js";
import { QuickRateFeature } from "./features/quick-rate.js";
import { RatingWorkflowFeature } from "./features/rating-workflow.js";
import { RecommendationFeature } from "./features/recommendations.js";
import { StatusUiFeature } from "./features/status-ui.js";
import { SocialContextFeature } from "./features/social-context.js";
import { SetupGuideFeature } from "./features/setup-guide.js";
import { SettingsFeature } from "./features/settings.js";
import { DescribeSource, MakeSignature, NormalizeMovieList } from "./movies.js";
import {
  ApplyAccountSettings,
  BuildAccountPreferences,
  ClearLegacyBrowserData,
  HasLegacyBrowserData,
  ReadLegacyRatingsCsv,
  ReadLegacyState
} from "./browser-settings.js";
import { BuildCheckedAiState, BuildCheckedLiveState, BuildMediaState, BuildStoragePayload } from "./state.js";
import { BuildCompleteSummary, CountRatings } from "./stats.js";
import { UndoRating } from "./undo-rating.js";
import { EscapeHtml } from "./util.js";
import { LoginPath, PathForView } from "./view-routes.js";
import { NormalizeAccountPayload, ReadMediaPayload, WriteMediaPayload } from "../../shared/media.js";
import { NormalizeTitleFilters } from "../../shared/title-filters.js";
import { NormalizeRecommendationBasis } from "../../shared/recommendation-basis.js";
import { ReadStreamingCountry } from "../../shared/streaming-country.js";
import { UpdateTitleFilterButton } from "./title-filter-workflows.js";
import { NormalizeKeyboardShortcuts, ReadShortcutAction, ReadShortcutRating, SkipShortcutAction } from "../../shared/keyboard-shortcuts.js";
import { NormalizeHelpPreferences } from "../../shared/help-preferences.js";

const SecretSettingByType = Object.freeze({ imdb: "imdbConfigured" });
const MovieWatchlistLabel = "Movie Watchlist";
const QueryDelimiter = "?";
const RenderQueueAfterSnapshot = true;
const TvWatchlistLabel = "TV Watchlist";

export class RapidRaterApp {
  constructor() {
    this.InitializeBrowserState();
    this.InitializeSetupGuideState();
    this.InitializeHelpReminderState();
    this.InitializeAccountState();
    this.InitializeSynchronizationState();
    this.InitializeSubmissionState();
    this.InitializeMediaState();
  }


  async SignOut() {
    this.Elements.signOut.disabled = true;
    try {
      this.StopAccountServices();
      await this.RequestSignOut();
      window.location.replace(LoginPath);
    } catch (error) {
      this.Elements.signOut.disabled = false;
      throw error;
    }
  }

  StopAccountServices() {
    window.clearTimeout(this.SyncTimer);
    window.clearInterval(this.AccountRefreshTimer);
    this.RaterEvents?.close();
  }

  async RequestSignOut() {
    try {
      await this.RequestJson("/api/auth/logout", PostMethod, {});
    } catch (error) {
      if (error?.status !== 401)
        throw error;
    }
  }

  ShowView(view) {
    if (this.State.mediaType === TvMediaType && view === SyncView)
      view = RaterView;
    this.State.activeView = view;
    this.UpdateViewClasses(view);
    this.UpdateViewVisibility(view);
    this.UpdateViewTabs(view);
    this.UpdateActiveView(view);
    this.ScheduleHelpReminder(view);
  }

  UpdateViewClasses(view) {
    document.body.classList.toggle("rater-active", view === RaterView);
    document.body.classList.toggle("ai-active", view === AiView);
    document.body.classList.toggle("settings-active", this.IsSettingsView(view));
    document.body.classList.toggle("sync-active", view === SyncView);
    document.body.classList.toggle("friends-active", view === FriendsView);
  }

  UpdateViewVisibility(view) {
    this.Elements.raterView.hidden = view !== RaterView;
    this.Elements.recommendationView.hidden = view !== AiView;
    this.Elements.settingsView.hidden = !this.IsSettingsView(view);
    this.Elements.syncView.hidden = view !== SyncView;
    this.Elements.friendsView.hidden = view !== FriendsView;
    this.Elements.ratingFooter.hidden = view !== RaterView;
    this.Elements.mobileRatingBar.hidden = view !== RaterView;
  }

  UpdateViewTabs(view) {
    this.Elements.tabRater.classList.toggle(ActiveClass, view === RaterView);
    this.Elements.tabAi.classList.toggle(ActiveClass, view === AiView);
    this.Elements.tabSync.classList.toggle(ActiveClass, view === SyncView);
    this.Elements.tabFriends.classList.toggle(ActiveClass, view === FriendsView);
  }

  UpdateActiveView(view) {
    this.UpdateActiveSettingsView(view);
    if (view === AiView) {
      this.UpdateRecommendationBasisControl();
      this.UpdateRecommendationStatus();
    }
    if (view === SyncView)
      this.UpdateSyncView();
    if (view === FriendsView)
      this.RenderFriendLists();
  }

  UpdateActiveSettingsView(view) {
    if (!this.IsSettingsView(view))
      return;
    this.SelectSettingsSection(view);
    if (view === AiSettingsView)
      return this.SyncAiSettingsForm();
    if (view === SettingsView)
      this.SyncShortcutSettingsForm();
  }

  UpdateMediaUx() {
    const isTv = this.State.mediaType === TvMediaType;
    this.UpdateMediaIdentity(isTv);
    this.UpdateMediaNavigation(isTv);
    this.UpdateMediaLabels(isTv);
    this.UpdateMediaShortcut();
    this.UpdateRecommendationBasisControl();
    UpdateTitleFilterButton(this);
  }

  UpdateMediaIdentity(isTv) {
    document.body.classList.toggle("tv-mode", isTv);
    document.title = `IMDb Rapid Rater — ${isTv ? TvDisplayName : MovieDisplayName}`;
    this.Elements.switchMovies.classList.toggle(ActiveClass, !isTv);
    this.Elements.switchMovies.setAttribute(AriaPressedAttribute, String(!isTv));
    this.Elements.switchTv.classList.toggle(ActiveClass, isTv);
    this.Elements.switchTv.setAttribute(AriaPressedAttribute, String(isTv));
    this.Elements.switchMovies.disabled = this.MediaSwitching;
    this.Elements.switchTv.disabled = this.MediaSwitching;
    this.Elements.brandMode.textContent = isTv ? TvDisplayName : MovieDisplayName;
  }

  UpdateMediaNavigation(isTv) {
    this.Elements.viewTabs.setAttribute("aria-label", isTv ? "TV show views" : "Movie views");
    this.Elements.tabRater.textContent = isTv ? "Rate Shows" : "Rate Movies";
    this.Elements.tabAi.textContent = isTv ? TvWatchlistLabel : MovieWatchlistLabel;
    this.Elements.tabRater.href = PathForView(RaterView, this.State.mediaType);
    this.Elements.tabAi.href = PathForView(AiView, this.State.mediaType);
    this.Elements.tabSync.href = PathForView(SyncView, MovieMediaType);
    this.Elements.tabFriends.href = PathForView(FriendsView, this.State.mediaType);
  }

  UpdateMediaLabels(isTv) {
    this.Elements.ratedLabel.textContent = isTv ? "Shows rated" : "Movies rated";
    this.Elements.skipLabel.textContent = isTv ? NotWatchedLabel : NotSeenLabel;
    this.Elements.poolLabel.textContent = isTv ? "Show pool" : "Movie pool";
    this.Elements.recommendationTitle.textContent = isTv ? TvWatchlistLabel : MovieWatchlistLabel;
    this.Elements.recommendationDescription.textContent = this.ReadRecommendationDescription(isTv);
    this.Elements.watchlistTitle.textContent = isTv ? "Saved TV watchlist" : "Saved movie watchlist";
    this.Elements.emptyTitle.textContent = isTv ? "TV show pool exhausted" : "Movie pool exhausted";
    this.Elements.touchNotSeen.textContent = isTv ? NotWatchedLabel : NotSeenLabel;
    this.Elements.desktopNotSeen.querySelector("span").textContent = isTv ? NotWatchedLabel : NotSeenLabel;
  }

  ReadRecommendationDescription(isTv) {
    if (isTv)
      return "A saved TV library shaped by your ratings, filters, and exclusions.";
    return "A saved movie library shaped by your ratings, filters, and exclusions.";
  }

  UpdateMediaShortcut() {
    const shortcutCopy = this.Elements.ratingFooter.querySelector(".shortcut-copy span");
    if (shortcutCopy)
      shortcutCopy.textContent = `Choose a score or use your assigned keys. Backspace = go back.`;
    this.ApplyShortcutUi();
  }

  HandleKeyDown(event) {
    if (this.State.activeView !== RaterView)
      return;
    if (this.IsDialogOpen())
      return;
    if (this.IsFormControlTarget(event.target))
      return;
    if (event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (!this.HandleControlKey(event))
      this.HandleShortcutKey(event);
  }

  IsDialogOpen() {
    return this.ReadSetupDialogs().some((dialog) => !dialog.hidden);
  }

  ReadSetupDialogs() {
    return [
      this.Elements.imdbDialog,
      this.Elements.regionDialog,
      this.Elements.filtersDialog,
      this.Elements.recommendationDetails,
      this.Elements.shareDialog,
      this.Elements.setupGuideDialog
    ];
  }

  IsFormControlTarget(target) {
    if (!target)
      return false;
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
  }

  HandleControlKey(event) {
    if (event.key === BackspaceKey || event.key === DeleteKey) {
      event.preventDefault();
      this.FlashShortcutAction(UndoShortcutAction);
      this.Undo().catch((error) => this.ShowToast(EscapeHtml(error.message || "Could not go back.")));
      return true;
    }
    return false;
  }

  HandleShortcutKey(event) {
    const action = ReadShortcutAction(this.Settings.keyboardShortcuts, event.key);
    if (!action)
      return;
    event.preventDefault();
    this.FlashShortcutAction(action);
    if (action === SkipShortcutAction)
      return this.MarkActive(null, "notSeen");
    this.MarkActive(ReadShortcutRating(action), "rated");
  }

  FlashShortcutAction(action) {
    const element = this.Elements.ratingFooter.querySelector(`[data-shortcut-action="${action}"]`);
    if (!element)
      return;
    element.classList.remove(PressedClass);
    void element.offsetWidth;
    element.classList.add(PressedClass);
    window.setTimeout(() => element.classList.remove(PressedClass), 180);
  }

  async ActivateMedia(mediaType, view = RaterView) {
    const token = ++this.MediaSwitchToken;
    this.MediaSwitching = true;
    const saved = this.PrepareMediaSwitch(mediaType);
    this.ApplyMediaSwitchState(saved, mediaType);
    this.UpdateMediaUx();
    this.ShowView(view);
    try {
      await this.LoadActivatedMedia(token, mediaType);
    } finally {
      this.FinishMediaSwitch(token);
    }
  }

  PrepareMediaSwitch(mediaType) {
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, this.State.mediaType, BuildStoragePayload(this.State));
    this.RaterEvents?.close();
    this.RaterEvents = null;
    return ReadMediaPayload(this.AccountPayload, mediaType);
  }

  ApplyMediaSwitchState(saved, mediaType) {
    const fresh = BuildMediaState();
    const savedState = this.BuildSavedMediaState(saved, fresh, mediaType);
    Object.assign(this.State, BuildMediaState(), savedState, this.BuildResetMediaState());
  }

  BuildSavedMediaState(saved, fresh, mediaType) {
    return {
      mediaType,
      ratings: saved.ratings || {},
      recommendationExclusions: saved.recommendationExclusions || [],
      filters: NormalizeTitleFilters(saved.filters),
      recommendationBasis: NormalizeRecommendationBasis(saved.recommendationBasis),
      letterboxd: saved.letterboxd || fresh.letterboxd,
      history: Array.isArray(saved.history) ? saved.history.slice(-200) : []
    };
  }

  BuildResetMediaState() {
    return {
      metadata: {},
      savedQueueIds: null,
      queueRevision: 0,
      queuePoolVersion: "",
      queueReady: false,
      locked: false
    };
  }

  async LoadActivatedMedia(token, mediaType) {
    const data = await this.LoadMediaData(mediaType);
    if (token !== this.MediaSwitchToken)
      return;
    this.ApplyMovieData(data, data.sourceLabel, mediaType);
    if (this.StateDirty)
      await this.FlushStateSync();
    await this.LoadRaterQueue();
    await this.RefreshRecommendationQueue({ force: true, silent: true });
    await this.RefreshRaterQueue();
    this.StartRaterEvents();
  }

  FinishMediaSwitch(token) {
    if (token !== this.MediaSwitchToken)
      return;
    this.MediaSwitching = false;
    this.UpdateMediaUx();
  }

  async LoadMediaData(mediaType = this.State.mediaType) {
    if (this.Catalogs[mediaType])
      return this.Catalogs[mediaType];
    const dataUrl = Config.dataUrls[mediaType];
    const data = await this.FetchJson(dataUrl).catch((error) => this.ThrowMediaDataError(error, mediaType));
    const fileName = mediaType === TvMediaType ? "shows.json" : "movies.json";
    const catalog = { ...data, sourceLabel: DescribeSource(data, fileName) };
    this.Catalogs[mediaType] = catalog;
    return catalog;
  }

  async LoadRaterQueue() {
    const payload = await this.FetchJson(this.MediaUrl(Config.raterQueueUrl));
    this.ApplyRaterQueueSnapshot(payload.queue, RenderQueueAfterSnapshot);
  }

  async RefreshRaterQueue() {
    if (!this.User || !this.State.movies.length)
      return false;
    const payload = await this.FetchJson(this.MediaUrl(Config.raterQueueUrl));
    const revision = Number(payload.queue?.revision) || 0;
    const changed = !this.State.queueReady || revision !== this.State.queueRevision
      || String(payload.queue?.poolVersion || "") !== this.State.queuePoolVersion;
    if (changed)
      this.ApplyRaterQueueSnapshot(payload.queue, RenderQueueAfterSnapshot);
    return changed;
  }

  async ReplaceRaterQueue(queueIds) {
    if (!Array.isArray(queueIds) || !this.State.queueReady)
      return false;
    const request = { mediaType: this.State.mediaType, expectedRevision: this.State.queueRevision, queueIds };
    try {
      return await this.RequestRaterQueueReplacement(request);
    } catch (error) {
      if (error?.payload?.current)
        this.ApplyRaterQueueSnapshot(error.payload.current, RenderQueueAfterSnapshot);
      throw error;
    }
  }

  async RequestRaterQueueReplacement(request) {
    const payload = await this.RequestJson(Config.raterQueueUrl, PutMethod, request);
    this.ApplyRaterQueueSnapshot(payload.queue, RenderQueueAfterSnapshot);
    return true;
  }

  ApplyRaterQueueSnapshot(snapshot, render = false) {
    const queueIds = Array.isArray(snapshot?.queueIds) ? snapshot.queueIds.map(String) : [];
    this.State.savedQueueIds = queueIds;
    this.State.queueRevision = Number(snapshot?.revision) || 0;
    this.State.queuePoolVersion = String(snapshot?.poolVersion || "");
    this.State.queueReady = this.State.queueRevision > 0;
    this.RebuildQueue();
    if (render)
      this.Render();
  }

  StartRaterEvents() {
    if (this.RaterEvents || typeof EventSource === "undefined")
      return;
    this.RaterEvents = new EventSource(this.MediaUrl(Config.raterEventsUrl));
    this.RaterEvents.addEventListener("queue", (event) => this.HandleRaterQueueEvent(event));
  }

  HandleRaterQueueEvent(event) {
    const update = JSON.parse(event.data || "{}");
    const revision = Number(update.revision) || 0;
    const isNewActiveQueue = update.mediaType === this.State.mediaType && revision > this.State.queueRevision;
    if (isNewActiveQueue)
      this.RefreshRemoteState().catch(() => null);
  }

  NewActionId() {
    if (globalThis.crypto?.randomUUID)
      return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
    if (!bytes)
      throw new Error("This browser cannot create a safe queue action identifier.");
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  ThrowMediaDataError(error, mediaType) {
    const label = mediaType === TvMediaType ? TvShowName : MovieMediaType;
    throw new Error(`Real ${label} data is missing. Run npm run build:data, then restart the app. ${error.message}`);
  }

  MediaUrl(url, mediaType = this.State.mediaType) {
    return `${url}${url.includes(QueryDelimiter) ? "&" : QueryDelimiter}media=${mediaType}`;
  }

  async FetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, cache: NoStoreCache });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error || `${url} returned HTTP ${response.status}`);
    return payload;
  }

  async RequestJson(url, method, body, options = {}) {
    const request = {
      method,
      cache: NoStoreCache,
      headers: { "content-type": "application/json", "x-csrf-token": this.CsrfToken },
      body: JSON.stringify(body),
      ...options
    };
    const response = await fetch(url, request);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok)
      throw Object.assign(new Error(payload?.error || `${url} returned HTTP ${response.status}`), { status: response.status, payload });
    return payload;
  }

  async LoadAccountState() {
    const account = await this.FetchJson("/api/account/state");
    ApplyAccountSettings(this.Settings, account.settings);
    this.ApplyShortcutUi();
    this.SyncHelpPreferenceUi();
    this.AccountPayload = NormalizeAccountPayload(account.payload);
    this.RatingsCsvText = account.ratingsCsv || "";
    this.AccountRevision = Number(account.revision) || 0;
    this.StateDirty = false;
  }

  async OfferLegacyMigration() {
    if (!HasLegacyBrowserData(this.LegacySettings))
      return;
    if (this.HasSavedAccountData())
      return ClearLegacyBrowserData();
    const count = Object.keys(ReadLegacyState().ratings || {}).length;
    this.Elements.migrationSummary.textContent = `${count.toLocaleString()} saved rating records were found in this browser.`;
    const shouldImport = await this.ReadLegacyMigrationDecision();
    this.Elements.migrationDialog.hidden = true;
    if (!shouldImport)
      return ClearLegacyBrowserData();
    await this.ImportLegacyAccount();
  }

  HasSavedAccountData() {
    const hasRatings = [MovieMediaType, TvMediaType].some((mediaType) => Object.keys(ReadMediaPayload(this.AccountPayload, mediaType).ratings || {}).length > 0);
    return hasRatings || this.AccountRevision > 0;
  }

  async ReadLegacyMigrationDecision() {
    this.Elements.migrationDialog.hidden = false;
    return await new Promise((resolve) => this.BindLegacyMigrationDecision(resolve));
  }

  BindLegacyMigrationDecision(resolve) {
    this.Elements.migrationImport.onclick = () => resolve(true);
    this.Elements.migrationSkip.onclick = () => resolve(false);
  }

  async ImportLegacyAccount() {
    this.AccountPayload = NormalizeAccountPayload(ReadLegacyState());
    this.RatingsCsvText = ReadLegacyRatingsCsv();
    await this.ImportLegacySecrets();
    await this.FlushStateSync();
    ClearLegacyBrowserData();
    this.ShowToast("This browser's save is now stored in your account.");
  }

  async ImportLegacySecrets() {
    const secrets = [[ImdbSecretType, this.LegacySettings.imdbCookie], ["openai", this.LegacySettings.openAiApiKey]];
    for (const [type, value] of secrets) {
      if (value)
        await this.SaveAccountSecret(type, value);
    }
  }

  async LoadSavedRatingsCsv() {
    const text = this.RatingsCsvText;
    if (!text)
      return;
    const result = ImportImdbCsv(text, this.State.ratings, this.State.movieById, this.BuildImportOptions(this.State.mediaType));
    if (!result.changed)
      return;
    this.RebuildQueue();
    this.SaveLocalState();
    await this.FlushStateSync();
    this.Render();
  }

  async RefreshLiveStatus() {
    const status = await this.FetchJson(Config.liveStatusUrl).catch((error) => ({ dryRun: false, lastError: error.message }));
    this.State.live = BuildCheckedLiveState(status);
    this.UpdateStats();
    this.UpdateSyncView();
  }

  async RefreshAiStatus() {
    const status = await this.FetchJson(Config.aiStatusUrl);
    this.State.ai = BuildCheckedAiState(status);
    this.UpdateAiControls();
    this.SyncAiSettingsForm();
  }

  ApplyMovieData(raw, sourceLabel, mediaType = this.State.mediaType) {
    const movies = NormalizeMovieList(raw);
    if (!movies.length)
      throw new Error(`No valid tt-style ${mediaType === TvMediaType ? TvShowName : MovieMediaType} IDs were found.`);
    const typedMovies = movies.map((movie) => ({ ...movie, mediaType }));
    this.State.movies = typedMovies;
    this.State.movieById = new Map(typedMovies.map((movie) => [movie.ttId, movie]));
    this.State.sourceLabel = sourceLabel || DescribeSource(raw, "custom data");
    this.State.signature = MakeSignature(typedMovies);
    this.Catalogs[mediaType] = { ...raw, sourceLabel, normalized: typedMovies, movieById: this.State.movieById };
    if (mediaType === TvMediaType)
      this.RedistributeKnownTvRatings();
    this.RestoreLocalState();
    this.Render();
  }

  async EnsureCatalog(mediaType) {
    const existing = this.Catalogs[mediaType];
    if (existing?.movieById)
      return existing;
    const raw = existing || await this.LoadMediaData(mediaType);
    const normalized = NormalizeMovieList(raw).map((title) => ({ ...title, mediaType }));
    const catalog = { ...raw, normalized, movieById: new Map(normalized.map((title) => [title.ttId, title])) };
    this.Catalogs[mediaType] = catalog;
    return catalog;
  }

  BuildImportOptions(mediaType) {
    const otherType = mediaType === TvMediaType ? MovieMediaType : TvMediaType;
    const otherIds = this.Catalogs[otherType]?.movieById ? new Set(this.Catalogs[otherType].movieById.keys()) : null;
    return { mediaType, otherTitleIds: otherIds };
  }

  RedistributeKnownTvRatings() {
    const tvIds = new Set(this.Catalogs.tv?.movieById?.keys?.() || []);
    if (!tvIds.size)
      return;
    const movie = ReadMediaPayload(this.AccountPayload, MovieMediaType);
    const tv = ReadMediaPayload(this.AccountPayload, TvMediaType);
    const movieRatings = { ...(movie.ratings || {}) };
    const tvRatings = { ...(tv.ratings || {}) };
    const changed = this.MoveKnownTvRatings(movieRatings, tvRatings, tvIds);
    if (!changed)
      return;
    this.SaveRatingRedistribution(movie, tv, movieRatings, tvRatings, tvIds);
    this.StateDirty = true;
  }

  SaveRatingRedistribution(movie, tv, movieRatings, tvRatings, tvIds) {
    const movieHistory = Array.isArray(movie.history) ? movie.history : [];
    const tvHistory = Array.isArray(tv.history) ? tv.history : [];
    this.SaveMovieRedistribution(movie, movieRatings, movieHistory, tvIds);
    this.SaveTvRedistribution(tv, tvRatings, tvHistory, movieHistory, tvIds);
  }

  MoveKnownTvRatings(movieRatings, tvRatings, tvIds) {
    let changed = false;
    for (const [ttId, record] of Object.entries(movieRatings)) {
      if (!tvIds.has(ttId))
        continue;
      tvRatings[ttId] = { ...record, mediaType: TvMediaType };
      delete movieRatings[ttId];
      changed = true;
    }
    return changed;
  }

  SaveMovieRedistribution(movie, movieRatings, movieHistory, tvIds) {
    const payload = {
      ...movie,
      ratings: movieRatings,
      history: movieHistory.filter((item) => !tvIds.has(item?.ttId))
    };
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, MovieMediaType, payload);
  }

  SaveTvRedistribution(tv, tvRatings, tvHistory, movieHistory, tvIds) {
    const movedHistory = movieHistory.filter((item) => tvIds.has(item?.ttId));
    const payload = {
      ...tv,
      ratings: tvRatings,
      history: [...tvHistory, ...movedHistory].slice(-200)
    };
    this.AccountPayload = WriteMediaPayload(this.AccountPayload, TvMediaType, payload);
  }

  RebuildQueue() {
    const activeIds = this.BuildUnavailableRatingIds();
    const queuedIds = new Set();
    this.State.queue = this.BuildSavedQueue(activeIds, queuedIds);
  }

  BuildUnavailableRatingIds() {
    const ids = new Set(Object.keys(this.State.ratings));
    for (const recommendation of this.State.recommendationQueue || []) {
      if (/^tt\d+$/.test(String(recommendation?.ttId || "")))
        ids.add(recommendation.ttId);
    }
    return ids;
  }

  RemoveWishlistedMoviesFromRatingQueue() {
    const wishlistedIds = new Set((this.State.recommendationQueue || []).map((item) => item.ttId).filter((ttId) => /^tt\d+$/.test(String(ttId || ""))));
    if (!wishlistedIds.size)
      return false;
    const previousLength = this.State.queue.length;
    this.State.queue = this.State.queue.filter((movie) => !wishlistedIds.has(movie.ttId));
    return this.State.queue.length !== previousLength;
  }

  BuildSavedQueue(activeIds, queuedIds) {
    if (!this.State.savedQueueIds)
      return [];
    const movies = this.State.savedQueueIds.map((ttId) => this.State.movieById.get(ttId));
    return movies.filter((movie) => this.CanRestoreQueuedMovie(movie, activeIds, queuedIds));
  }

  CanRestoreQueuedMovie(movie, activeIds, queuedIds) {
    if (!movie)
      return false;
    const isAlreadyActive = activeIds.has(movie.ttId);
    const isAlreadyQueued = queuedIds.has(movie.ttId);
    if (isAlreadyActive || isAlreadyQueued)
      return false;
    queuedIds.add(movie.ttId);
    return true;
  }

  ShowImdbDialog() {
    this.ShowImdbError("");
    this.Elements.imdbDialog.hidden = false;
    window.setTimeout(() => this.Elements.imdbInput.focus(), 0);
  }

  HideImdbDialog() {
    this.Elements.imdbInput.value = "";
    this.ShowImdbError("");
    this.Elements.imdbDialog.hidden = true;
  }

  ShowRegionDialog() {
    this.ShowRegionError("");
    this.Elements.regionCountry.value = ReadStreamingCountry(this.Settings.streamingCountry);
    this.Elements.regionDialog.hidden = false;
    window.setTimeout(() => this.Elements.regionCountry.focus(), 0);
  }

  HideRegionDialog() {
    this.ShowRegionError("");
    this.Elements.regionDialog.hidden = true;
  }

  async PostJson(url, body) {
    return await this.RequestJson(url, PostMethod, body);
  }

  async SaveAccountSecret(type, value) {
    const result = await this.RequestJson(`/api/account/secrets/${type}`, PutMethod, { value });
    const setting = SecretSettingByType[type];
    if (setting)
      this.Settings[setting] = true;
    return result;
  }

  async DeleteAccountSecret(type) {
    await this.RequestJson(`/api/account/secrets/${type}`, "DELETE", {});
    this.Elements.imdbDialog.hidden = true;
    await this.RefreshLiveStatus();
    this.ShowToast("The saved credential was removed from your account.");
  }

  async SaveAccountPreferences(changes = {}) {
    const request = BuildAccountPreferences(this.Settings, changes);
    const payload = await this.RequestJson("/api/account/preferences", PutMethod, request);
    this.Settings.streamingCountry = ReadStreamingCountry(payload.streamingCountry);
    this.Settings.keyboardShortcuts = NormalizeKeyboardShortcuts(payload.keyboardShortcuts);
    this.Settings.helpPreferences = NormalizeHelpPreferences(payload.helpPreferences);
    this.ApplyShortcutUi();
    this.SyncHelpPreferenceUi();
  }

  RefreshVisibleMetadata() {
    const titleIds = this.ReadVisibleMetadataTitleIds();
    for (const ttId of titleIds)
      delete this.State.metadata[ttId];
    if (this.State.queue.length)
      this.RenderVisibleCards();
    for (const ttId of titleIds)
      this.EnrichTitleMetadata(ttId);
  }

  ReadVisibleMetadataTitleIds() {
    const titleIds = this.State.queue.slice(0, Config.visibleCount).map((movie) => movie.ttId);
    const cards = this.Elements.recommendationGrid.querySelectorAll("[data-ttid]");
    return new Set([...titleIds, ...Array.from(cards, (card) => card.dataset.ttid)].filter(Boolean));
  }

  SetImdbSaving(value) {
    this.Elements.imdbSave.disabled = value;
    this.Elements.imdbSave.textContent = value ? "Connecting..." : "Connect IMDb";
  }

  SetRegionSaving(value) {
    this.Elements.regionSave.disabled = value;
    this.Elements.regionSave.textContent = value ? SavingLabel : "Save viewing region";
  }

  SetAiControlsDisabled(value) {
    const disabled = value || !this.State.ai.configured;
    this.Elements.generateRecommendations.disabled = disabled;
    this.Elements.recommendationCount.disabled = disabled;
    this.Elements.recommendationBasis.disabled = Boolean(value);
  }

  ShowImdbError(message) {
    this.Elements.imdbError.textContent = message || "";
  }

  ShowRegionError(message) {
    this.Elements.regionError.textContent = message || "";
  }

  async Undo() {
    await UndoRating(this);
  }

  async RestoreHistoryItem(last, movie) {
    const request = {
      mediaType: this.State.mediaType,
      actionId: this.NewActionId(),
      expectedRevision: this.State.queueRevision,
      titleId: movie.ttId
    };
    const payload = await this.RequestJson(Config.raterUndoUrl, PutMethod, request);
    this.ApplyRestoredRating(last, payload);
    this.ApplyRestoredHistoryPayload(payload);
  }

  ApplyRestoredRating(last, payload) {
    if (payload.record)
      this.State.ratings[last.ttId] = payload.record;
    else
      delete this.State.ratings[last.ttId];
  }

  ApplyRestoredHistoryPayload(payload) {
    this.State.history.pop();
    this.AccountRevision = Math.max(this.AccountRevision, Number(payload.stateRevision) || 0);
    const mediaPayload = {
      ratings: { ...this.State.ratings },
      history: this.State.history.slice(-200)
    };
    this.UpdateActiveMediaPayload(mediaPayload);
    this.ApplyRaterQueueSnapshot(payload.queue);
    this.Render();
    this.UpdateSyncView();
  }

  ShowComplete() {
    const counts = CountRatings(this.State.ratings);
    this.Elements.strip.innerHTML = "";
    this.Elements.emptySummary.textContent = BuildCompleteSummary(counts, this.State.mediaType);
    this.Elements.empty.hidden = false;
  }

  ShowStartupError(error) {
    console.error(error);
    this.Elements.sourceBadge.textContent = "Load failed";
    this.ShowToast(`Could not load ${this.State.mediaType === TvMediaType ? TvShowName : MovieMediaType} data: ${EscapeHtml(error.message)}`);
  }

  ShowToast(html) {
    this.Elements.toast.innerHTML = html;
    this.Elements.toast.classList.add(ShowClass);
    window.clearTimeout(this.ToastTimer);
    this.ToastTimer = window.setTimeout(() => this.Elements.toast.classList.remove(ShowClass), 900);
  }

}

InstallFeatureMethods(RapidRaterApp, AccountSyncFeature.prototype, AiSettingsFeature.prototype, ApplicationLifecycleFeature.prototype, CatalogViewFeature.prototype, CollectionSyncFeature.prototype, DataTransferFeature.prototype, EventBindingsFeature.prototype, FriendsFeature.prototype, HelpRemindersFeature.prototype, QuickRateFeature.prototype, RatingWorkflowFeature.prototype, RecommendationFeature.prototype, SettingsFeature.prototype, SetupGuideFeature.prototype, SocialContextFeature.prototype, StatusUiFeature.prototype);
