import { Config } from "./config.js";
import { BuildElements } from "./elements.js";
import { DescribeSource, MakeSignature, NormalizeMovieList } from "./movies.js";
import {
  BuildAiPreferenceProfile,
  BuildCsvText,
  BuildRateRequest,
  BuildRatingRecord,
  CanSubmitLive,
  ImportImdbCsv,
  IsRetryableImdbSubmit
} from "./rating-records.js";
import {
  RenderCard,
  RenderFailure,
  RenderModelOptions,
  RenderRecommendationCard,
  RenderRecommendationEmpty,
  RenderRecommendationSkeletons,
  UpdatePoster,
  UpdateRecommendationPoster,
  UpdateSynopsis
} from "./rendering.js";
import {
  ApplyAccountSettings,
  ClearLegacyBrowserData,
  HasLegacyBrowserData,
  ReadBrowserSettings,
  ReadLegacyRatingsCsv,
  ReadLegacyState
} from "./browser-settings.js";
import { BindRecommendationRatings } from "./recommendation-ratings.js";
import {
  SaveAiKeyFromDialog,
  SaveImdbConnectionFromDialog,
  SaveSelectedAiModel,
  SaveTmdbKeyFromDialog
} from "./settings-workflows.js";
import { BuildCheckedAiState, BuildCheckedLiveState, BuildState, BuildStoragePayload } from "./state.js";
import { BuildCompleteSummary, CountRatings } from "./stats.js";
import { UndoRating } from "./undo-rating.js";
import { EscapeHtml, FormatCount, Shuffle } from "./util.js";

const RecommendationCount = 8;
const RecommendationLoadingMessages = [
  "Reading the signals in your ratings...",
  "Finding patterns across genres and eras...",
  "Comparing stories, directors, and hidden gems...",
  "Narrowing the list to your strongest matches...",
  "Giving the final picks a last look..."
];

export class RapidRaterApp {
  constructor() {
    this.Elements = BuildElements();
    this.Settings = ReadBrowserSettings();
    this.LegacySettings = { ...this.Settings };
    this.State = BuildState();
    this.AccountPayload = {};
    this.RatingsCsvText = "";
    this.AccountRevision = 0;
    this.CsrfToken = "";
    this.User = null;
    this.SyncTimer = 0;
    this.SyncPromise = Promise.resolve();
    this.Initialized = false;
    this.ToastTimer = 0;
    this.AiLoadingTimer = 0;
    this.AiLoadingMessageIndex = 0;
    this.SubmitInFlight = false;
    this.SubmitQueue = [];
    this.SubmitQueuedIds = new Set();
    this.SubmitActiveIds = new Set();
    this.MetadataInFlight = new Set();
    document.documentElement.style.setProperty("--anim", `${Config.animationMs}ms`);
  }

  Start() {
    this.BindEvents();
    this.BeginSession().catch((error) => this.ShowStartupError(error));
  }

  async Initialize() {
    if (this.Initialized)
      return;
    this.Initialized = true;
    await this.LoadAccountState();
    await this.OfferLegacyMigration();
    await this.RefreshLiveStatus();
    await this.RefreshAiStatus();
    const data = await this.LoadMovieData();
    this.ApplyMovieData(data, data.sourceLabel);
    await this.LoadSavedRatingsCsv();
    this.RequireImdbSignIn();
  }

  Element(id) {
    return document.getElementById(id);
  }

  BindEvents() {
    this.BindViewEvents();
    this.BindToolbarEvents();
    this.BindSetupEvents();
    this.BindAiEvents();
    this.BindFileEvents();
    this.BindAccountEvents();
    this.BindMobileEvents();
    window.addEventListener("keydown", (event) => this.HandleKeyDown(event));
  }

  BindViewEvents() {
    this.Elements.tabRater.addEventListener("click", () => this.ShowView("rater"));
    this.Elements.tabAi.addEventListener("click", () => this.ShowView("ai"));
  }

  BindToolbarEvents() {
    this.Element("load-json").addEventListener("click", () => this.Elements.jsonFile.click());
    this.Element("import-csv").addEventListener("click", () => this.Elements.csvFile.click());
    this.Element("export-csv").addEventListener("click", () => this.ExportCsv());
    this.Element("export-json").addEventListener("click", () => this.ExportJson());
    this.Element("empty-export-csv").addEventListener("click", () => this.ExportCsv());
    this.Element("empty-export-json").addEventListener("click", () => this.ExportJson());
    this.Elements.retryFailed.addEventListener("click", () => this.RetryImdbFailures());
    this.Elements.failureRetry.addEventListener("click", () => this.RetryImdbFailures());
  }

  BindSetupEvents() {
    this.Elements.configureImdb.addEventListener("click", () => this.ShowImdbDialog());
    this.Elements.imdbSave.addEventListener("click", () => SaveImdbConnectionFromDialog(this).catch((error) => this.ShowImdbError(error.message)));
    this.Elements.imdbDelete.addEventListener("click", () => this.DeleteAccountSecret("imdb"));
    this.Elements.configureTmdb.addEventListener("click", () => this.ShowTmdbDialog());
    this.Elements.tmdbClose.addEventListener("click", () => this.HideTmdbDialog());
    this.Elements.tmdbLater.addEventListener("click", () => this.HideTmdbDialog());
    this.Elements.tmdbSave.addEventListener("click", () => SaveTmdbKeyFromDialog(this).catch((error) => this.ShowTmdbError(error.message)));
    this.Elements.tmdbDelete.addEventListener("click", () => this.DeleteAccountSecret("tmdb"));
  }

  BindAiEvents() {
    this.Elements.configureAi.addEventListener("click", () => this.ShowAiDialog());
    this.Elements.aiClose.addEventListener("click", () => this.HideAiDialog());
    this.Elements.aiLater.addEventListener("click", () => this.HideAiDialog());
    this.Elements.aiSave.addEventListener("click", () => this.HandleAiSaveClick());
    this.Elements.aiDelete.addEventListener("click", () => this.DeleteAccountSecret("openai"));
    this.Elements.generateRecommendations.addEventListener("click", () => this.HandleRecommendationClick());
    this.Elements.refreshAiModels.addEventListener("click", () => this.HandleModelRefreshClick());
    this.Elements.aiModelSelect.addEventListener("change", () => this.HandleModelSelectChange());
    BindRecommendationRatings(this);
  }

  HandleAiSaveClick() {
    SaveAiKeyFromDialog(this).catch((error) => this.ShowAiError(error.message));
  }

  HandleRecommendationClick() {
    this.GenerateRecommendations().catch((error) => this.ShowRecommendationError(error.message));
  }

  HandleModelRefreshClick() {
    this.RefreshAiModels().catch((error) => this.ShowRecommendationError(error.message));
  }

  HandleModelSelectChange() {
    SaveSelectedAiModel(this).catch((error) => this.ShowRecommendationError(error.message));
  }

  BindFileEvents() {
    this.Elements.jsonFile.addEventListener("change", (event) => this.HandleJsonFile(event));
    this.Elements.csvFile.addEventListener("change", (event) => this.HandleCsvFile(event));
  }

  BindAccountEvents() {
    this.Elements.loginForm.addEventListener("submit", (event) => this.HandleLogin(event));
    this.Elements.signupForm.addEventListener("submit", (event) => this.HandleSignup(event));
    this.Elements.showLogin.addEventListener("click", () => this.ShowAuthPanel("login"));
    this.Elements.showSignup.addEventListener("click", () => this.ShowAuthPanel("signup"));
    this.Elements.signOut.addEventListener("click", () => this.SignOut());
  }

  BindMobileEvents() {
    this.Elements.mobileRatingBar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-touch-rating]");
      if (button)
        this.MarkActive(Number(button.dataset.touchRating), "rated");
    });
    this.Elements.touchNotSeen.addEventListener("click", () => this.MarkActive(null, "notSeen"));
    this.Elements.touchUndo.addEventListener("click", () => this.Undo());
  }

  async BeginSession() {
    const session = await this.FetchJson("./api/auth/session");
    this.CsrfToken = session.csrfToken || "";
    if (!session.authenticated)
      return this.ShowAuthLanding(session.registrationEnabled !== false);
    this.SetSignedInUser(session.user);
    await this.Initialize();
  }

  async HandleLogin(event) {
    event.preventDefault();
    this.Elements.loginError.textContent = "";
    this.Elements.loginSubmit.disabled = true;
    try {
      const payload = await this.RequestJson("./api/auth/login", "POST", {
        email: this.Elements.loginEmail.value,
        password: this.Elements.loginPassword.value
      });
      this.CsrfToken = payload.csrfToken;
      this.SetSignedInUser(payload.user);
      this.Elements.authLanding.hidden = true;
      this.Elements.loginPassword.value = "";
      await this.Initialize();
    } catch (error) {
      this.Elements.loginError.textContent = error.message;
    } finally {
      this.Elements.loginSubmit.disabled = false;
    }
  }

  async HandleSignup(event) {
    event.preventDefault();
    this.Elements.signupError.textContent = "";
    const password = this.Elements.signupPassword.value;
    if (password !== this.Elements.signupConfirmation.value) {
      this.Elements.signupError.textContent = "The passwords do not match.";
      return;
    }
    this.Elements.signupSubmit.disabled = true;
    try {
      const payload = await this.RequestJson("./api/auth/register", "POST", {
        email: this.Elements.signupEmail.value,
        password
      });
      this.CsrfToken = payload.csrfToken;
      this.SetSignedInUser(payload.user);
      this.Elements.signupPassword.value = "";
      this.Elements.signupConfirmation.value = "";
      await this.Initialize();
    } catch (error) {
      this.Elements.signupError.textContent = error.message;
    } finally {
      this.Elements.signupSubmit.disabled = false;
    }
  }

  ShowAuthLanding(registrationEnabled = true) {
    this.Elements.authLanding.hidden = false;
    this.Elements.signOut.hidden = true;
    this.Elements.showSignup.hidden = !registrationEnabled;
    this.ShowAuthPanel("login");
    window.setTimeout(() => this.Elements.loginEmail.focus(), 0);
  }

  ShowAuthPanel(panel) {
    const signup = panel === "signup";
    this.Elements.loginPanel.hidden = signup;
    this.Elements.signupPanel.hidden = !signup;
    this.Elements.showLogin.classList.toggle("active", !signup);
    this.Elements.showSignup.classList.toggle("active", signup);
    this.Elements.loginError.textContent = "";
    this.Elements.signupError.textContent = "";
    window.setTimeout(() => (signup ? this.Elements.signupEmail : this.Elements.loginEmail).focus(), 0);
  }

  SetSignedInUser(user) {
    this.User = user;
    this.Elements.accountBadge.textContent = user?.email || "Signed in";
    this.Elements.signOut.hidden = false;
    this.Elements.authLanding.hidden = true;
  }

  async SignOut() {
    await this.FlushStateSync().catch(() => null);
    await this.RequestJson("./api/auth/logout", "POST", {});
    window.location.reload();
  }

  ShowView(view) {
    this.State.activeView = view;
    this.Elements.raterView.hidden = view !== "rater";
    this.Elements.recommendationView.hidden = view !== "ai";
    this.Elements.ratingFooter.hidden = view !== "rater";
    this.Elements.tabRater.classList.toggle("active", view === "rater");
    this.Elements.tabAi.classList.toggle("active", view === "ai");
    if (view === "ai")
      this.UpdateRecommendationStatus();
  }

  HandleKeyDown(event) {
    if (this.State.activeView !== "rater")
      return;
    if (this.IsDialogOpen())
      return;
    if (this.IsFormControlTarget(event.target))
      return;
    if (event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (this.HandleControlKey(event))
      return;
    this.HandleRatingKey(event);
  }

  IsDialogOpen() {
    return this.ReadSetupDialogs().some((dialog) => !dialog.hidden);
  }

  ReadSetupDialogs() {
    return [
      this.Elements.imdbDialog,
      this.Elements.tmdbDialog,
      this.Elements.aiDialog
    ];
  }

  IsFormControlTarget(target) {
    if (!target)
      return false;
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
  }

  HandleControlKey(event) {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      this.FlashShortcutKey(event.key);
      this.Undo().catch((error) => this.ShowToast(EscapeHtml(error.message || "Undo failed.")));
      return true;
    }
    if (event.key !== Config.skipKey)
      return false;
    event.preventDefault();
    this.FlashShortcutKey(event.key);
    this.MarkActive(null, "notSeen");
    return true;
  }

  HandleRatingKey(event) {
    if (!Object.hasOwn(Config.ratingKeys, event.key))
      return;
    event.preventDefault();
    this.FlashShortcutKey(event.key);
    this.MarkActive(Config.ratingKeys[event.key], "rated");
  }

  FlashShortcutKey(key) {
    const id = this.ShortcutIdForKey(key);
    const element = this.Elements.ratingFooter.querySelector(`[data-shortcut="${id}"]`);
    if (!element)
      return;
    element.classList.remove("pressed");
    void element.offsetWidth;
    element.classList.add("pressed");
    window.setTimeout(() => element.classList.remove("pressed"), 180);
  }

  ShortcutIdForKey(key) {
    if (key === "Backspace" || key === "Delete")
      return "undo";
    if (key === Config.skipKey)
      return "skip";
    return `rate-${key}`;
  }

  async LoadMovieData() {
    const data = await this.FetchJson(Config.dataUrl).catch((error) => this.ThrowMovieDataError(error));
    return { ...data, sourceLabel: DescribeSource(data, "movies.json") };
  }

  ThrowMovieDataError(error) {
    throw new Error(`Real movie data is missing. Run npm run build:data, then restart the app. ${error.message}`);
  }

  async FetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error || `${url} returned HTTP ${response.status}`);
    return payload;
  }

  async RequestJson(url, method, body) {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: { "content-type": "application/json", "x-csrf-token": this.CsrfToken },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok)
      throw Object.assign(new Error(payload?.error || `${url} returned HTTP ${response.status}`), { status: response.status, payload });
    return payload;
  }

  async LoadAccountState() {
    const account = await this.FetchJson("./api/account/state");
    ApplyAccountSettings(this.Settings, account.settings);
    this.AccountPayload = account.payload || {};
    this.RatingsCsvText = account.ratingsCsv || "";
    this.AccountRevision = Number(account.revision) || 0;
  }

  async OfferLegacyMigration() {
    if (!HasLegacyBrowserData(this.LegacySettings))
      return;
    const hasAccountData = Object.keys(this.AccountPayload?.ratings || {}).length > 0 || this.AccountRevision > 0;
    if (hasAccountData)
      return ClearLegacyBrowserData();
    const count = Object.keys(ReadLegacyState().ratings || {}).length;
    this.Elements.migrationSummary.textContent = `${count.toLocaleString()} saved rating records were found in this browser.`;
    const shouldImport = await new Promise((resolve) => {
      this.Elements.migrationDialog.hidden = false;
      this.Elements.migrationImport.onclick = () => resolve(true);
      this.Elements.migrationSkip.onclick = () => resolve(false);
    });
    this.Elements.migrationDialog.hidden = true;
    if (!shouldImport)
      return ClearLegacyBrowserData();
    this.AccountPayload = ReadLegacyState();
    this.RatingsCsvText = ReadLegacyRatingsCsv();
    for (const [type, value] of [["imdb", this.LegacySettings.imdbCookie], ["tmdb", this.LegacySettings.tmdbApiKey], ["openai", this.LegacySettings.openAiApiKey]]) {
      if (value)
        await this.SaveAccountSecret(type, value);
    }
    if (this.LegacySettings.openAiModel)
      await this.SaveAccountPreferences(this.LegacySettings.openAiModel);
    await this.FlushStateSync();
    ClearLegacyBrowserData();
    this.ShowToast("This browser's save is now stored in your account.");
  }

  async LoadSavedRatingsCsv() {
    const text = this.RatingsCsvText;
    if (!text)
      return;
    const result = ImportImdbCsv(text, this.State.ratings, this.State.movieById);
    if (!result.changed)
      return;
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  async RefreshLiveStatus() {
    const status = await this.FetchJson(Config.liveStatusUrl).catch((error) => ({ dryRun: false, lastError: error.message }));
    this.State.live = BuildCheckedLiveState({
      ...status
    });
    this.UpdateStats();
  }

  async RefreshAiStatus() {
    const status = await this.FetchJson(Config.aiStatusUrl);
    this.State.ai = BuildCheckedAiState(status);
    this.UpdateAiControls();
    if (this.State.ai.configured)
      await this.RefreshAiModels().catch(() => null);
  }

  ApplyMovieData(raw, sourceLabel) {
    const movies = NormalizeMovieList(raw);
    if (!movies.length)
      throw new Error("No valid tt-style movie IDs were found.");
    this.State.movies = movies;
    this.State.movieById = new Map(movies.map((movie) => [movie.ttId, movie]));
    this.State.sourceLabel = sourceLabel || DescribeSource(raw, "custom data");
    this.State.signature = MakeSignature(movies);
    this.RestoreLocalState();
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  RestoreLocalState() {
    const saved = this.ReadStoredState();
    this.State.ratings = saved.ratings || {};
    this.State.recommendationExclusions = this.NormalizeRecommendationExclusions(saved.recommendationExclusions);
    this.State.history = Array.isArray(saved.history) ? saved.history : [];
    this.State.savedQueueIds = saved.signature === this.State.signature && Array.isArray(saved.queueIds) ? saved.queueIds : null;
  }

  ReadStoredState() {
    return this.AccountPayload || {};
  }

  SaveLocalState() {
    this.AccountPayload = BuildStoragePayload(this.State);
    window.clearTimeout(this.SyncTimer);
    this.SyncTimer = window.setTimeout(() => this.FlushStateSync().catch((error) => this.ShowToast(EscapeHtml(error.message))), 300);
  }

  async FlushStateSync() {
    window.clearTimeout(this.SyncTimer);
    this.SyncPromise = this.SyncPromise.catch(() => null).then(() => this.PerformStateSync());
    return await this.SyncPromise;
  }

  async PerformStateSync() {
    const result = await this.RequestJson("./api/account/state", "PUT", {
      payload: this.AccountPayload || BuildStoragePayload(this.State),
      ratingsCsv: this.RatingsCsvText || "",
      revision: this.AccountRevision
    });
    this.AccountRevision = Number(result.revision);
  }

  RebuildQueue() {
    const activeIds = new Set(Object.keys(this.State.ratings));
    const queuedIds = new Set();
    const savedQueue = this.BuildSavedQueue(activeIds, queuedIds);
    const freshQueue = this.State.movies.filter((movie) => !activeIds.has(movie.ttId) && !queuedIds.has(movie.ttId));
    this.State.queue = savedQueue.concat(Shuffle(freshQueue));
  }

  BuildSavedQueue(activeIds, queuedIds) {
    if (!this.State.savedQueueIds)
      return [];
    return this.State.savedQueueIds
      .map((ttId) => this.State.movieById.get(ttId))
      .filter((movie) => this.CanRestoreQueuedMovie(movie, activeIds, queuedIds));
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

  Render() {
    this.UpdateStats();
    this.Elements.sourceBadge.textContent = this.State.sourceLabel;
    if (!this.State.queue.length) {
      this.ShowComplete();
      return;
    }
    this.RenderVisibleCards();
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
    return RenderCard(movie, index, metadata, this.State.queue.length);
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
      synopsis: "To see the synopsis, set up a TMDB key.",
      source: ""
    };
  }

  async FetchTitleMetadata(ttId) {
    const payload = await this.FetchJson(`${Config.titleMetadataUrl}${ttId}`, this.BuildMetadataFetchOptions());
    if (!payload.ok)
      throw new Error(payload.error || "Metadata request failed.");
    return {
      posterUrl: payload.posterUrl || "",
      synopsis: payload.synopsis || "To see the synopsis, set up a TMDB key.",
      source: payload.source || ""
    };
  }

  BuildMetadataFetchOptions() {
    return {};
  }

  ApplyTitleMetadata(ttId, metadata) {
    this.State.metadata[ttId] = metadata;
    const card = this.Elements.strip.querySelector(`[data-ttid="${ttId}"]`);
    if (card) {
      UpdatePoster(card, metadata);
      UpdateSynopsis(card, metadata);
    }
    for (const recommendation of this.Elements.recommendationGrid.querySelectorAll(`[data-ttid="${ttId}"]`))
      UpdateRecommendationPoster(recommendation, metadata);
  }

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
    this.Elements.poolStatus.textContent = this.State.queue.length ? "Ready" : "Empty";
  }

  UpdateLiveBadge(counts) {
    this.UpdateSettingsButtons();
    this.UpdateRetryButtons(counts);
    if (!this.State.live.checked)
      return this.SetLiveBadge("status-chip live-missing", "Live checking");
    if (!this.State.live.configured)
      return this.SetLiveBadge("status-chip live-missing", "IMDb connection required");
    if (counts.failed > 0)
      return this.SetLiveBadge("status-chip live-failed", `Live ${FormatCount(counts.failed)} failed`);
    if (counts.pending > 0 || this.State.live.submitting)
      return this.SetLiveBadge("status-chip live-ready", `Live ${FormatCount(counts.pending)} pending`);
    this.SetLiveBadge("status-chip live-ready", this.State.live.dryRun ? "Live dry run" : "Live ready");
  }

  SetLiveBadge(className, text) {
    this.Elements.liveBadge.className = className;
    this.Elements.liveBadge.textContent = text;
  }

  UpdateSettingsButtons() {
    this.UpdateImdbButton();
    this.UpdateTmdbButton();
  }

  UpdateImdbButton() {
    const configured = this.State.live.configured;
    this.Elements.configureImdb.className = configured ? "status-chip live-ready" : "status-chip live-missing";
    this.Elements.configureImdb.textContent = configured ? "IMDb connected" : "Connect IMDb";
  }

  UpdateTmdbButton() {
    const configured = this.State.live.tmdbConfigured;
    this.Elements.configureTmdb.className = configured ? "status-chip metadata-ready" : "status-chip metadata-missing";
    this.Elements.configureTmdb.textContent = configured ? "TMDB ready" : "Set TMDB Key";
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
    this.SetRecommendationStatus(`Ready with ${this.ReadAiModelLabel()}.`);
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
    const ratings = Object.values(this.State.ratings);
    const failed = ratings.filter((record) => record.submitStatus === "failed");
    const failures = failed.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 5);
    if (!failures.length) {
      this.Elements.failurePanel.hidden = true;
      this.Elements.failureList.innerHTML = "";
      return;
    }
    this.Elements.failurePanel.hidden = false;
    this.Elements.failureList.innerHTML = failures.map(RenderFailure).join("");
  }

  MarkActive(rating, status) {
    if (this.State.locked || !this.State.queue.length)
      return;
    this.State.locked = true;
    const movie = this.State.queue[0];
    this.SaveRating(movie, rating, status);
    this.AnimateActiveCard(status);
    this.ShowRatingToast(movie, rating, status);
    window.setTimeout(() => this.AdvanceQueue(), Config.animationMs);
  }

  SaveRating(movie, rating, status) {
    const previous = this.State.ratings[movie.ttId] || null;
    this.State.ratings[movie.ttId] = BuildRatingRecord(movie, rating, status, this.State.live.configured);
    this.State.history.push({ ttId: movie.ttId, previous });
    if (status === "rated")
      this.EnqueueLiveSubmit(movie.ttId);
  }

  AnimateActiveCard(status) {
    const card = this.Elements.strip.firstElementChild;
    if (!card)
      return;
    this.Elements.strip.classList.add("rating");
    card.classList.remove("active");
    card.classList.add("leaving", status === "notSeen" ? "skip" : "rated");
  }

  ShowRatingToast(movie, rating, status) {
    const value = status === "rated" ? rating : "not seen";
    this.ShowToast(`${EscapeHtml(movie.title)} <strong>${value}</strong>`);
  }

  AdvanceQueue() {
    this.State.queue.shift();
    this.SaveLocalState();
    this.State.locked = false;
    this.Render();
  }

  EnqueueLiveSubmit(ttId) {
    const record = this.State.ratings[ttId];
    if (!CanSubmitLive(record, this.State.live.configured))
      return false;
    record.submitStatus = "pending";
    record.submitError = "";
    const queued = this.QueueSubmitId(ttId);
    this.SaveLocalState();
    this.UpdateStats();
    this.PumpSubmitQueue();
    return queued;
  }

  QueueSubmitId(ttId) {
    const isQueued = this.SubmitQueuedIds.has(ttId);
    const isSubmitting = this.SubmitActiveIds.has(ttId);
    if (isQueued || isSubmitting)
      return false;
    this.SubmitQueue.push(ttId);
    this.SubmitQueuedIds.add(ttId);
    return true;
  }

  async PumpSubmitQueue() {
    if (this.SubmitInFlight || !this.SubmitQueue.length)
      return;
    const ttId = this.PopSubmitId();
    const record = this.State.ratings[ttId];
    if (!CanSubmitLive(record, this.State.live.configured))
      return this.PumpSubmitQueue();
    await this.SubmitRatingRecord(record);
  }

  PopSubmitId() {
    const ttId = this.SubmitQueue.shift();
    this.SubmitQueuedIds.delete(ttId);
    return ttId;
  }

  async SubmitRatingRecord(record) {
    this.SetSubmitInFlight(true);
    this.SubmitActiveIds.add(record.ttId);
    try {
      const result = await this.PostLiveRating(record);
      this.MarkSubmitSuccess(record.ttId, result.rating ?? record.rating);
    } catch (error) {
      this.MarkSubmitFailure(record.ttId, error.message || "IMDb submit failed.");
      if (/cookie|sign.?in|auth/i.test(error.message || ""))
        this.RequireImdbSignIn();
    }
    this.SubmitActiveIds.delete(record.ttId);
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
    return BuildRateRequest(record);
  }

  MarkSubmitSuccess(ttId, rating) {
    const current = this.State.ratings[ttId];
    if (!current)
      return;
    Object.assign(current, { submitStatus: "submitted", submitError: "", submittedAt: new Date().toISOString(), imdbEchoRating: rating });
    this.SaveLocalState();
  }

  MarkSubmitFailure(ttId, error) {
    const current = this.State.ratings[ttId];
    if (!current)
      return;
    Object.assign(current, { submitStatus: "failed", submitError: error, submittedAt: "" });
    this.SaveLocalState();
  }

  ScheduleNextSubmit() {
    window.setTimeout(() => {
      this.SetSubmitInFlight(false);
      this.PumpSubmitQueue();
    }, Config.submitDelayMs);
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

  ShowImdbDialog() {
    this.ShowImdbError("");
    this.Elements.imdbDialog.hidden = false;
    window.setTimeout(() => this.Elements.imdbInput.focus(), 0);
  }

  HideImdbDialog() {
    if (!this.State.live.configured)
      return;
    this.Elements.imdbInput.value = "";
    this.ShowImdbError("");
    this.Elements.imdbDialog.hidden = true;
  }

  ShowTmdbDialog() {
    this.ShowTmdbError("");
    this.Elements.tmdbDialog.hidden = false;
    window.setTimeout(() => this.Elements.tmdbInput.focus(), 0);
  }

  HideTmdbDialog() {
    this.Elements.tmdbInput.value = "";
    this.ShowTmdbError("");
    this.Elements.tmdbDialog.hidden = true;
  }

  ShowAiDialog() {
    this.ShowAiError("");
    this.Elements.aiDialog.hidden = false;
    window.setTimeout(() => this.Elements.aiInput.focus(), 0);
  }

  HideAiDialog() {
    this.Elements.aiInput.value = "";
    this.ShowAiError("");
    this.Elements.aiDialog.hidden = true;
  }

  async PostJson(url, body, message) {
    try {
      return await this.RequestJson(url, "POST", body);
    } catch (error) {
      throw new Error(error.message || message);
    }
  }

  async SaveAccountSecret(type, value) {
    await this.RequestJson(`./api/account/secrets/${type}`, "PUT", { value });
    const setting = type === "imdb" ? "imdbConfigured" : type === "tmdb" ? "tmdbConfigured" : "openAiConfigured";
    this.Settings[setting] = true;
  }

  async DeleteAccountSecret(type) {
    await this.RequestJson(`./api/account/secrets/${type}`, "DELETE", {});
    if (type === "imdb") {
      this.Elements.imdbDialog.hidden = true;
      await this.RefreshLiveStatus();
    } else if (type === "tmdb") {
      this.Elements.tmdbDialog.hidden = true;
      await this.RefreshLiveStatus();
      this.RefreshVisibleMetadata();
    } else {
      this.Elements.aiDialog.hidden = true;
      await this.RefreshAiStatus();
    }
    this.ShowToast("The saved credential was removed from your account.");
  }

  async SaveAccountPreferences(model) {
    const payload = await this.RequestJson("./api/account/preferences", "PUT", {
      openAiModel: model,
      openAiModelLag: Number(this.Settings.openAiModelLag) || 2
    });
    this.Settings.openAiModel = payload.openAiModel;
    this.Settings.openAiModelLag = payload.openAiModelLag;
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

  SetTmdbSaving(value) {
    this.Elements.tmdbSave.disabled = value;
    this.Elements.tmdbSave.textContent = value ? "Saving..." : "Save API Key";
  }

  SetAiSaving(value) {
    this.Elements.aiSave.disabled = value;
    this.Elements.aiSave.textContent = value ? "Saving..." : "Save API Key";
  }

  SetAiControlsDisabled(value) {
    const disabled = value || !this.State.ai.configured;
    this.Elements.generateRecommendations.disabled = disabled;
    this.Elements.refreshAiModels.disabled = disabled;
    this.Elements.aiModelSelect.disabled = disabled;
  }

  SetAiModelSaving(value) {
    this.State.ai.loading = value;
    this.SetAiControlsDisabled(value);
    this.SetRecommendationStatus(value ? "Saving model selection..." : "");
  }

  ShowImdbError(message) {
    this.Elements.imdbError.textContent = message || "";
  }

  ShowTmdbError(message) {
    this.Elements.tmdbError.textContent = message || "";
  }

  ShowAiError(message) {
    this.Elements.aiError.textContent = message || "";
  }

  async GenerateRecommendations() {
    if (!this.State.ai.configured)
      return this.ShowAiDialog();
    this.SetAiLoading(true);
    const payload = await this.RequestRecommendations().finally(() => this.SetAiLoading(false));
    this.RenderRecommendations(payload);
  }

  async RequestRecommendations() {
    return await this.PostJson(Config.recommendationsUrl, this.BuildRecommendationRequest(), "AI recommendation request failed.");
  }

  BuildRecommendationRequest() {
    return {
      count: RecommendationCount,
      profile: BuildAiPreferenceProfile(this.State.ratings, this.State.movieById, this.State.recommendationExclusions)
    };
  }

  AddRecommendationExclusion(value) {
    const exclusion = this.NormalizeRecommendationExclusion(value);
    if (!exclusion)
      return null;
    const key = this.RecommendationExclusionKey(exclusion);
    const others = this.State.recommendationExclusions.filter((item) => this.RecommendationExclusionKey(item) !== key);
    this.State.recommendationExclusions = [...others, exclusion];
    this.SaveLocalState();
    return exclusion;
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
    const ttId = /^tt\d+$/.test(String(value?.ttId || "").trim()) ? String(value.ttId).trim() : "";
    const movie = this.State.movieById.get(ttId) || {};
    const title = String(value?.title || movie.title || "").replace(/\s+/g, " ").trim();
    if (!title)
      return null;
    return {
      ttId,
      title,
      year: Number(value?.year || movie.year) || null,
      at: String(value?.at || new Date().toISOString())
    };
  }

  RecommendationExclusionKey(value) {
    const title = String(value?.title || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
    return `${title}|${Number(value?.year) || ""}`;
  }

  async RefreshAiModels() {
    if (!this.State.ai.configured)
      return;
    const payload = await this.FetchJson(Config.aiModelsUrl, this.BuildAiModelsFetchOptions());
    this.ApplyAiModelFeed(payload);
  }

  BuildAiModelsFetchOptions() {
    return {};
  }

  ApplyAiModelFeed(payload) {
    this.State.ai.model = payload.explicitModel || "";
    this.State.ai.selectedModel = payload.selectedModel || "";
    this.State.ai.models = Array.isArray(payload.models) ? payload.models : [];
    this.State.ai.modelLag = Number(payload.modelLag) || this.State.ai.modelLag;
    this.UpdateAiControls();
  }

  SetAiLoading(value) {
    this.State.ai.loading = value;
    this.SetAiControlsDisabled(value);
    this.Elements.generateRecommendations.textContent = value ? "Finding movies..." : "Generate picks";
    this.Elements.recommendationLoading.hidden = !value;
    window.clearInterval(this.AiLoadingTimer);
    if (!value) {
      this.AiLoadingTimer = 0;
      return;
    }
    this.AiLoadingMessageIndex = 0;
    this.UpdateAiLoadingMessage();
    this.Elements.recommendationGrid.classList.add("is-loading");
    this.Elements.recommendationGrid.setAttribute("aria-busy", "true");
    this.Elements.recommendationGrid.innerHTML = RenderRecommendationSkeletons(RecommendationCount);
    this.SetRecommendationStatus("Your personalized cinema lineup is being prepared.");
    this.AiLoadingTimer = window.setInterval(() => {
      this.AiLoadingMessageIndex = (this.AiLoadingMessageIndex + 1) % RecommendationLoadingMessages.length;
      this.UpdateAiLoadingMessage();
    }, 1800);
  }

  UpdateAiLoadingMessage() {
    this.Elements.recommendationLoadingCopy.textContent = RecommendationLoadingMessages[this.AiLoadingMessageIndex];
  }

  RenderRecommendations(payload) {
    this.SetRecommendationStatus(payload.summary || "Recommendations ready.");
    const items = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    this.Elements.recommendationGrid.classList.remove("is-loading");
    this.Elements.recommendationGrid.setAttribute("aria-busy", "false");
    this.Elements.recommendationGrid.innerHTML = items.length ? items.map(RenderRecommendationCard).join("") : RenderRecommendationEmpty();
    for (const item of items)
      this.EnrichTitleMetadata(item.ttId);
  }

  ShowRecommendationError(message) {
    this.SetAiLoading(false);
    this.Elements.recommendationGrid.classList.remove("is-loading");
    this.Elements.recommendationGrid.setAttribute("aria-busy", "false");
    this.Elements.recommendationGrid.innerHTML = `<div class="recommendation-empty recommendation-error"><span aria-hidden="true">!</span><h2>We couldn't finish that lineup</h2><p>Nothing was changed. Check the message above and try again.</p></div>`;
    this.SetRecommendationStatus(message || "Could not generate recommendations.");
  }

  async Undo() {
    await UndoRating(this);
  }

  RestoreHistoryItem(last, movie) {
    if (last.previous)
      this.State.ratings[last.ttId] = last.previous;
    else
      delete this.State.ratings[last.ttId];
    const isAlreadyQueued = this.State.queue.some((queued) => queued.ttId === movie.ttId);
    if (!isAlreadyQueued)
      this.State.queue.unshift(movie);
    this.SaveLocalState();
    this.Render();
  }

  ShowComplete() {
    const counts = CountRatings(this.State.ratings);
    this.Elements.strip.innerHTML = "";
    this.Elements.emptySummary.textContent = BuildCompleteSummary(counts);
    this.Elements.empty.hidden = false;
  }

  async HandleJsonFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const parsed = JSON.parse(await file.text());
    if (this.IsRatingSave(parsed))
      return this.ImportRatingSave(parsed, file.name);
    this.ApplyMovieData(parsed, file.name);
    this.ShowToast(`Loaded <strong>${FormatCount(this.State.movies.length)}</strong> titles`);
  }

  IsRatingSave(parsed) {
    if (parsed?.format === "imdb-rapid-rater-save" || parsed?.ratings || parsed?.state?.ratings)
      return true;
    return Array.isArray(parsed) && parsed.some((item) => this.IsRatingRecord(item));
  }

  ImportRatingSave(parsed, fileName) {
    const source = this.ReadRatingSaveSource(parsed);
    const ratings = this.NormalizeSavedRatings(source.ratings);
    const exclusions = this.NormalizeRecommendationExclusions(source.recommendationExclusions);
    if (!Object.keys(ratings).length && !exclusions.length)
      throw new Error("The selected JSON file does not contain any Rapid Rater records.");
    this.ApplyImportedRatingSave(source, ratings);
    const counts = CountRatings(ratings);
    this.ShowToast(`Restored <strong>${FormatCount(Object.keys(ratings).length)}</strong> records and <strong>${FormatCount(exclusions.length)}</strong> AI exclusions from ${EscapeHtml(fileName)}, including <strong>${FormatCount(counts.skipped)}</strong> not seen`);
  }

  ReadRatingSaveSource(parsed) {
    if (Array.isArray(parsed))
      return { ratings: parsed, recommendationExclusions: [], history: [], queueIds: null, signature: "", merge: true };
    const state = parsed.state || parsed;
    return {
      ratings: state.ratings || {},
      recommendationExclusions: Array.isArray(state.recommendationExclusions) ? state.recommendationExclusions : [],
      history: Array.isArray(state.history) ? state.history : [],
      queueIds: Array.isArray(state.queueIds) ? state.queueIds : null,
      signature: String(state.signature || ""),
      merge: false
    };
  }

  NormalizeSavedRatings(value) {
    const records = Array.isArray(value) ? value : Object.values(value || {});
    const normalized = {};
    for (const record of records) {
      if (!this.IsRatingRecord(record))
        continue;
      normalized[record.ttId] = { ...record, ttId: String(record.ttId).trim() };
    }
    return normalized;
  }

  IsRatingRecord(record) {
    const validStatus = ["rated", "imported", "notSeen"].includes(record?.status);
    return validStatus && /^tt\d+$/.test(String(record?.ttId || "").trim());
  }

  ApplyImportedRatingSave(source, ratings) {
    this.State.ratings = source.merge ? { ...this.State.ratings, ...ratings } : ratings;
    if (!source.merge)
      this.State.recommendationExclusions = this.NormalizeRecommendationExclusions(source.recommendationExclusions);
    this.State.history = source.merge ? this.State.history : source.history.slice(-200);
    this.State.savedQueueIds = source.signature === this.State.signature ? source.queueIds : null;
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
  }

  async HandleCsvFile(event) {
    const file = this.TakeSelectedFile(event);
    if (!file)
      return;
    const text = await file.text();
    await this.SaveRatingsCsvText(text);
    const result = ImportImdbCsv(text, this.State.ratings, this.State.movieById);
    this.RebuildQueue();
    this.SaveLocalState();
    this.Render();
    this.ShowToast(this.BuildCsvSyncToast(result));
  }

  BuildCsvSyncToast(result) {
    const count = FormatCount(result.count);
    const applied = FormatCount(result.applied);
    const removed = FormatCount(result.removed);
    if (result.removed > 0)
      return `Synced and saved <strong>${count}</strong> IMDb ratings. Added/refreshed <strong>${applied}</strong>, removed stale <strong>${removed}</strong>.`;
    return `Synced and saved <strong>${count}</strong> IMDb ratings`;
  }

  async SaveRatingsCsvText(text) {
    this.RatingsCsvText = text;
    this.SaveLocalState();
    return { ok: true };
  }

  TakeSelectedFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    return file;
  }

  ExportCsv() {
    const csv = BuildCsvText(this.State.ratings);
    this.Download("imdb-rapid-rater-export.csv", csv, "text/csv;charset=utf-8");
  }

  ExportJson() {
    const save = {
      format: "imdb-rapid-rater-save",
      version: 2,
      exportedAt: new Date().toISOString(),
      state: BuildStoragePayload(this.State)
    };
    this.Download("imdb-rapid-rater-save.json", JSON.stringify(save, null, 2), "application/json;charset=utf-8");
  }

  Download(fileName, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  ShowStartupError(error) {
    console.error(error);
    this.Elements.sourceBadge.textContent = "Load failed";
    this.ShowToast(`Could not load movie data: ${EscapeHtml(error.message)}`);
  }

  ShowToast(html) {
    this.Elements.toast.innerHTML = html;
    this.Elements.toast.classList.add("show");
    window.clearTimeout(this.ToastTimer);
    this.ToastTimer = window.setTimeout(() => this.Elements.toast.classList.remove("show"), 900);
  }

}
