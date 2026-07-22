import { Config } from "../config.js";
import { ActiveClass, MovieMediaType, PostMethod, RaterView } from "../app-constants.js";
import { BuildElements } from "../elements.js";
import { ReadBrowserSettings } from "../browser-settings.js";
import { BuildState } from "../state.js";
import { IsCanonicalViewPath, IsLoginPath, LoginPath, PathForView, RouteFromPathname } from "../view-routes.js";

const DefaultRecommendationCount = 9;

export class ApplicationLifecycleFeature {
  InitializeBrowserState() {
    this.Elements = BuildElements();
    this.Settings = ReadBrowserSettings();
    this.LegacySettings = { ...this.Settings };
    this.RecommendationPostersCollapsed = this.ReadRecommendationPosterPreference();
    this.CollapsedRecommendationRows = new Set();
    this.State = BuildState();
    this.Catalogs = {};
  }

  InitializeAccountState() {
    this.AccountPayload = {};
    this.RatingsCsvText = "";
    this.AccountRevision = 0;
    this.CsrfToken = "";
    this.User = null;
  }

  InitializeSynchronizationState() {
    this.SyncTimer = 0;
    this.SyncPromise = Promise.resolve();
    this.StateDirty = false;
    this.AccountRefreshTimer = 0;
    this.RaterEvents = null;
    this.Initialized = false;
  }

  InitializeSubmissionState() {
    this.ToastTimer = 0;
    this.AiLoadingTimer = 0;
    this.AiLoadingMessageIndex = 0;
    this.PendingRecommendationCount = DefaultRecommendationCount;
    this.SubmitInFlight = false;
    this.SubmitQueue = [];
    this.SubmitQueuedIds = new Set();
    this.SubmitActiveIds = new Set();
  }

  InitializeMediaState() {
    this.MetadataInFlight = new Set();
    this.MediaSwitchToken = 0;
    this.MediaSwitching = false;
    this.PendingRoute = { mediaType: MovieMediaType, view: RaterView };
    document.documentElement.style.setProperty("--anim", `${Config.animationMs}ms`);
  }

  Start() {
    this.BindEvents();
    this.UpdateRecommendationPosterVisibility();
    this.PendingRoute = RouteFromPathname(window.location.pathname);
    this.State.mediaType = this.PendingRoute.mediaType;
    this.UpdateMediaUx();
    this.ShowView(this.PendingRoute.view);
    this.BeginSession().catch((error) => this.ShowStartupError(error));
  }

  async Initialize() {
    if (this.Initialized)
      return;
    this.Initialized = true;
    await this.InitializeAccountData();
    await this.InitializeMediaData();
    this.StartBackgroundSynchronization();
    this.RequireImdbSignIn();
  }

  async InitializeAccountData() {
    await this.LoadAccountState();
    await this.OfferLegacyMigration();
    await this.RefreshLiveStatus();
    await this.RefreshAiStatus();
  }

  async InitializeMediaData() {
    const data = await this.LoadMediaData(this.State.mediaType);
    this.ApplyMovieData(data, data.sourceLabel, this.State.mediaType);
    if (this.StateDirty)
      await this.FlushStateSync();
    await this.LoadRaterQueue();
    await this.LoadSavedRatingsCsv();
    const refreshOptions = { force: true, silent: true };
    await this.RefreshRecommendationQueue(refreshOptions);
    await this.RefreshRaterQueue();
  }

  StartBackgroundSynchronization() {
    this.StartRaterEvents();
    this.StartAccountRefresh();
  }

  Element(id) {
    return document.getElementById(id);
  }

  async BeginSession() {
    const session = await this.FetchJson("/api/auth/session");
    this.CsrfToken = session.csrfToken || "";
    if (!session.authenticated)
      return this.ShowAuthLanding(session.registrationEnabled !== false);
    this.EnterAuthenticatedApp(session.user);
    await this.Initialize();
  }

  async HandleLogin(event) {
    event.preventDefault();
    this.Elements.loginError.textContent = "";
    this.Elements.loginSubmit.disabled = true;
    try {
      await this.CompleteLogin();
    } catch (error) {
      this.Elements.loginError.textContent = error.message;
    } finally {
      this.Elements.loginSubmit.disabled = false;
    }
  }

  async CompleteLogin() {
    const request = { email: this.Elements.loginEmail.value, password: this.Elements.loginPassword.value };
    const payload = await this.RequestJson("/api/auth/login", PostMethod, request);
    this.ApplyAuthenticatedPayload(payload);
    this.Elements.authLanding.hidden = true;
    this.Elements.loginPassword.value = "";
    await this.Initialize();
  }

  async HandleSignup(event) {
    event.preventDefault();
    this.Elements.signupError.textContent = "";
    const password = this.Elements.signupPassword.value;
    if (!this.IsSignupPasswordConfirmed(password))
      return;
    this.Elements.signupSubmit.disabled = true;
    await this.SubmitSignup(password);
  }

  async SubmitSignup(password) {
    try {
      await this.CompleteSignup(password);
    } catch (error) {
      this.Elements.signupError.textContent = error.message;
    } finally {
      this.Elements.signupSubmit.disabled = false;
    }
  }

  IsSignupPasswordConfirmed(password) {
    if (password === this.Elements.signupConfirmation.value)
      return true;
    this.Elements.signupError.textContent = "The passwords do not match.";
    return false;
  }

  async CompleteSignup(password) {
    const request = { email: this.Elements.signupEmail.value, password };
    const payload = await this.RequestJson("/api/auth/register", PostMethod, request);
    this.ApplyAuthenticatedPayload(payload);
    this.Elements.signupPassword.value = "";
    this.Elements.signupConfirmation.value = "";
    await this.Initialize();
  }

  ApplyAuthenticatedPayload(payload) {
    this.CsrfToken = payload.csrfToken;
    this.EnterAuthenticatedApp(payload.user);
  }

  ShowAuthLanding(registrationEnabled = true) {
    if (!IsLoginPath(window.location.pathname))
      window.history.replaceState({}, "", LoginPath);
    document.body.classList.remove("tv-mode");
    document.title = "IMDb Rapid Rater";
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
    this.Elements.showLogin.classList.toggle(ActiveClass, !signup);
    this.Elements.showSignup.classList.toggle(ActiveClass, signup);
    this.Elements.loginError.textContent = "";
    this.Elements.signupError.textContent = "";
    window.setTimeout(() => (signup ? this.Elements.signupEmail : this.Elements.loginEmail).focus(), 0);
  }

  SetSignedInUser(user) {
    this.User = user;
    this.CollapsedRecommendationRows = this.ReadCollapsedRecommendationRows();
    this.Elements.accountBadge.textContent = "Signed in";
    this.Elements.signOut.hidden = false;
    this.Elements.authLanding.hidden = true;
  }

  EnterAuthenticatedApp(user) {
    this.SetSignedInUser(user);
    const route = this.PendingRoute || { mediaType: MovieMediaType, view: RaterView };
    this.State.mediaType = route.mediaType;
    this.UpdateMediaUx();
    this.ShowView(route.view);
    const path = PathForView(route.view, route.mediaType);
    if (!IsCanonicalViewPath(window.location.pathname) || window.location.pathname !== path)
      window.history.replaceState(route, "", path);
  }
}
