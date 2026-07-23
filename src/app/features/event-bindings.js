import { Config } from "../config.js";
import { AiView, AriaExpandedAttribute, AriaPressedAttribute, ChangeEvent, ClickEvent, CollapsedPreference, ImdbSecretType, KeydownEvent, MovieMediaType, RaterView, SubmitEvent, SyncView, TmdbSecretType, TvMediaType } from "../app-constants.js";
import { BindRecommendationRatings } from "../recommendation-ratings.js";
import { SaveAiKeyFromDialog, SaveImdbConnectionFromDialog, SaveSelectedAiModel, SaveTmdbSettingsFromDialog } from "../settings-workflows.js";
import { ApplyRecommendationFilters, ApplyTitleFilters, ClearRecommendationFilters, HideTitleFilterDialog, ResetTitleFilterDialog, ShowTitleFilterDialog, UpdateRecommendationFilterPreview, UpdateTitleFilterPreview } from "../title-filter-workflows.js";
import { EscapeHtml } from "../util.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";
import { IsLoginPath, LoginPath, PathForView, RouteFromPathname } from "../view-routes.js";

export class EventBindingsFeature {
  BindEvents() {
    this.BindViewEvents();
    this.BindRaterEvents();
    this.BindQuickRateEvents();
    this.BindToolbarEvents();
    this.BindSetupEvents();
    this.BindAiEvents();
    this.BindSyncEvents();
    this.BindFileEvents();
    this.BindAccountEvents();
    this.BindMobileEvents();
    this.BindHeaderMenuEvents();
    this.BindWindowEvents();
    this.BindVisibilityEvent();
  }

  BindWindowEvents() {
    window.addEventListener(KeydownEvent, (event) => this.HandleKeyDown(event));
    window.addEventListener("focus", () => this.RefreshRemoteState().catch(() => null));
  }

  BindVisibilityEvent() {
    document.addEventListener("visibilitychange", () => this.HandleVisibilityChange());
  }

  HandleVisibilityChange() {
    if (!document.hidden)
      this.RefreshRemoteState().catch(() => null);
  }

  BindViewEvents() {
    this.BindViewLink(this.Elements.tabRater, RaterView);
    this.BindViewLink(this.Elements.tabAi, AiView);
    this.BindViewLink(this.Elements.tabSync, SyncView);
    this.Elements.switchMovies.addEventListener(ClickEvent, () => this.NavigateToMedia(MovieMediaType));
    this.Elements.switchTv.addEventListener(ClickEvent, () => this.NavigateToMedia(TvMediaType));
    window.addEventListener("popstate", () => this.ApplyBrowserRoute().catch((error) => this.ShowStartupError(error)));
  }

  BindViewLink(link, view) {
    link.addEventListener(ClickEvent, (event) => this.HandleViewLinkClick(event, view));
  }

  HandleViewLinkClick(event, view) {
    if (this.IsModifiedNavigationEvent(event))
      return;
    event.preventDefault();
    this.NavigateToView(view);
  }

  IsModifiedNavigationEvent(event) {
    const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    return event.defaultPrevented || event.button !== 0 || hasModifier;
  }

  NavigateToView(view) {
    const safeView = this.State.mediaType === TvMediaType && view === SyncView ? RaterView : view;
    const path = PathForView(safeView, this.State.mediaType);
    if (window.location.pathname !== path)
      window.history.pushState({ view: safeView, mediaType: this.State.mediaType }, "", path);
    this.ShowView(safeView);
  }

  NavigateToMedia(mediaType) {
    if (mediaType === this.State.mediaType)
      return;
    if (this.IsMediaSwitchBlocked())
      return this.ShowToast("Finish the current action before switching sections.");
    const view = this.State.activeView === SyncView ? RaterView : this.State.activeView;
    const path = PathForView(view, mediaType);
    window.history.pushState({ view, mediaType }, "", path);
    this.ActivateMedia(mediaType, view).catch((error) => this.ShowStartupError(error));
  }

  IsMediaSwitchBlocked() {
    return this.State.locked || this.State.ai.loading || this.MediaSwitching;
  }

  async ApplyBrowserRoute() {
    const route = RouteFromPathname(window.location.pathname);
    if (!this.User) {
      this.PendingRoute = route;
      if (!IsLoginPath(window.location.pathname))
        window.history.replaceState({}, "", LoginPath);
      return;
    }
    if (route.mediaType !== this.State.mediaType)
      return this.ActivateMedia(route.mediaType, route.view);
    this.ShowView(route.view);
  }

  BindToolbarEvents() {
    this.BindHeaderAction("load-json", () => this.Elements.jsonFile.click());
    this.BindHeaderAction("import-csv", () => this.Elements.csvFile.click());
    this.BindHeaderAction("export-csv", () => this.ExportCsv());
    this.BindHeaderAction("export-json", () => this.ExportJson());
    this.Element("empty-export-csv").addEventListener(ClickEvent, () => this.ExportCsv());
    this.Element("empty-export-json").addEventListener(ClickEvent, () => this.ExportJson());
    this.BindHeaderAction("retry-failed", () => this.RetryImdbFailures().catch((error) => this.ShowToast(EscapeHtml(error.message))));
    this.Elements.failureRetry.addEventListener(ClickEvent, () => this.RetryImdbFailures().catch((error) => this.ShowToast(EscapeHtml(error.message))));
  }

  BindHeaderAction(id, action) {
    this.Element(id).addEventListener(ClickEvent, () => this.RunHeaderAction(action));
  }

  RunHeaderAction(action) {
    this.CloseHeaderMenus();
    action();
  }

  BindSetupEvents() {
    this.BindFilterEvents();
    this.BindImdbSetupEvents();
    this.BindTmdbSetupEvents();
  }

  BindFilterEvents() {
    this.Elements.configureFilters.addEventListener(ClickEvent, () => ShowTitleFilterDialog(this));
    this.Elements.filtersClose.addEventListener(ClickEvent, () => HideTitleFilterDialog(this));
    this.Elements.filtersReset.addEventListener(ClickEvent, () => ResetTitleFilterDialog(this));
    this.Elements.filtersApply.addEventListener(ClickEvent, () => this.HandleApplyFilters());
    this.Elements.filtersDialog.addEventListener("input", () => UpdateTitleFilterPreview(this));
    this.Elements.filtersDialog.addEventListener(ChangeEvent, () => UpdateTitleFilterPreview(this));
    this.BindRecommendationFilterEvents();
  }

  BindRecommendationFilterEvents() {
    this.Elements.recommendationFilterApply.addEventListener(ClickEvent, () => this.HandleRecommendationFilterApply());
    this.Elements.recommendationFilterClear.addEventListener(ClickEvent, () => this.HandleRecommendationFilterClear());
    this.Elements.recommendationFilterMore.addEventListener(ClickEvent, () => ShowTitleFilterDialog(this));
    this.Elements.recommendationFilters.addEventListener("input", () => UpdateRecommendationFilterPreview(this));
    this.Elements.recommendationFilters.addEventListener(ChangeEvent, () => UpdateRecommendationFilterPreview(this));
  }

  HandleApplyFilters() {
    ApplyTitleFilters(this).catch((error) => this.ShowFilterError(error));
  }

  HandleRecommendationFilterApply() {
    ApplyRecommendationFilters(this).catch((error) => this.ShowFilterError(error));
  }

  HandleRecommendationFilterClear() {
    ClearRecommendationFilters(this).catch((error) => this.ShowFilterError(error));
  }

  ShowFilterError(error) {
    this.Elements.filterError.textContent = error.message || "Filters could not be applied.";
  }

  BindImdbSetupEvents() {
    this.BindHeaderAction("configure-imdb", () => this.ShowImdbDialog());
    this.Elements.imdbSave.addEventListener(ClickEvent, () => SaveImdbConnectionFromDialog(this).catch((error) => this.ShowImdbError(error.message)));
    this.Elements.imdbDelete.addEventListener(ClickEvent, () => this.DeleteAccountSecret(ImdbSecretType));
  }

  BindTmdbSetupEvents() {
    this.BindHeaderAction("configure-tmdb", () => this.ShowTmdbDialog());
    this.Elements.tmdbClose.addEventListener(ClickEvent, () => this.HideTmdbDialog());
    this.Elements.tmdbLater.addEventListener(ClickEvent, () => this.HideTmdbDialog());
    this.Elements.tmdbSave.addEventListener(ClickEvent, () => SaveTmdbSettingsFromDialog(this).catch((error) => this.ShowTmdbError(error.message)));
    this.Elements.tmdbDelete.addEventListener(ClickEvent, () => this.DeleteAccountSecret(TmdbSecretType));
  }

  BindAiEvents() {
    this.Elements.configureAi.addEventListener(ClickEvent, () => this.ShowAiDialog());
    this.BindHeaderAction("configure-openai", () => this.ShowAiDialog());
    this.Elements.aiClose.addEventListener(ClickEvent, () => this.HideAiDialog());
    this.Elements.aiLater.addEventListener(ClickEvent, () => this.HideAiDialog());
    this.Elements.aiSave.addEventListener(ClickEvent, () => this.HandleAiSaveClick());
    this.Elements.aiDelete.addEventListener(ClickEvent, () => this.DeleteAccountSecret("openai"));
    this.Elements.generateRecommendations.addEventListener(ClickEvent, () => this.HandleRecommendationClick());
    this.Elements.recommendationBasis.addEventListener(ChangeEvent, () => this.HandleRecommendationBasisChange());
    this.Elements.toggleRecommendationPosters.addEventListener(ClickEvent, () => this.ToggleRecommendationPosters());
    this.Elements.refreshAiModels.addEventListener(ClickEvent, () => this.HandleModelRefreshClick());
    this.Elements.aiModelSelect.addEventListener(ChangeEvent, () => this.HandleModelSelectChange());
    BindRecommendationRatings(this);
  }

  HandleAiSaveClick() {
    SaveAiKeyFromDialog(this).catch((error) => this.ShowAiError(error.message));
  }

  HandleRecommendationClick() {
    this.GenerateRecommendations().catch((error) => this.ShowRecommendationError(error.message));
  }

  HandleRecommendationBasisChange() {
    const basis = {
      source: this.Elements.recommendationBasis.value,
      updatedAt: new Date().toISOString()
    };
    this.State.recommendationBasis = NormalizeRecommendationBasis(basis);
    this.UpdateRecommendationBasisControl();
    this.PersistStateNow();
  }

  HandleModelRefreshClick() {
    this.RefreshAiModels().catch((error) => this.ShowRecommendationError(error.message));
  }

  HandleModelSelectChange() {
    SaveSelectedAiModel(this).catch((error) => this.ShowRecommendationError(error.message));
  }

  BindFileEvents() {
    this.Elements.jsonFile.addEventListener(ChangeEvent, (event) => this.HandleJsonFile(event));
    this.Elements.csvFile.addEventListener(ChangeEvent, (event) => this.HandleCsvFile(event));
    this.Elements.letterboxdFile.addEventListener(ChangeEvent, (event) => this.HandleLetterboxdFile(event).catch((error) => this.ShowSyncError(error)));
  }

  BindRaterEvents() {
    this.Elements.strip.addEventListener(ClickEvent, (event) => this.HandleRaterStripClick(event));
  }

  BindQuickRateEvents() {
    this.Elements.quickRateMenu.addEventListener("toggle", () => this.HandleQuickRateMenuToggle());
    this.Elements.quickRateSearch.addEventListener("input", () => this.HandleQuickRateSearchInput());
    this.Elements.quickRateSearch.addEventListener(KeydownEvent, (event) => this.HandleQuickRateSearchKey(event));
    this.Elements.quickRateResults.addEventListener(ClickEvent, (event) => this.HandleQuickRateResultsClick(event));
    this.Elements.quickRateRating.addEventListener("input", () => this.UpdateQuickRateSubmitState());
    this.Elements.quickRateForm.addEventListener(SubmitEvent, (event) => this.HandleQuickRateSubmit(event));
  }

  HandleRaterStripClick(event) {
    const button = event.target.closest?.("[data-add-active-to-wishlist]");
    if (!button)
      return;
    this.AddActiveMovieToWishlist(button).catch((error) => this.ShowWishlistError(error));
  }

  ShowWishlistError(error) {
    this.ShowToast(`<strong>Watchlist was not updated:</strong> ${EscapeHtml(error.message)}`);
  }

  ToggleRecommendationPosters() {
    this.RecommendationPostersCollapsed = !this.RecommendationPostersCollapsed;
    try {
      localStorage.setItem(Config.recommendationPosterPreferenceKey, this.RecommendationPostersCollapsed ? CollapsedPreference : "expanded");
    } catch {}
    this.UpdateRecommendationPosterVisibility();
  }

  ReadRecommendationPosterPreference() {
    try {
      return localStorage.getItem(Config.recommendationPosterPreferenceKey) === CollapsedPreference;
    } catch {
      return false;
    }
  }

  UpdateRecommendationPosterVisibility() {
    const collapsed = Boolean(this.RecommendationPostersCollapsed);
    this.Elements.recommendationGrid.classList.toggle("posters-collapsed", collapsed);
    this.Elements.toggleRecommendationPosters.setAttribute(AriaPressedAttribute, String(collapsed));
    this.Elements.toggleRecommendationPosters.textContent = collapsed ? "Show posters" : "Hide posters";
  }

  BindSyncEvents() {
    this.Elements.syncImportImdb.addEventListener(ClickEvent, () => this.Elements.csvFile.click());
    this.Elements.syncImportLetterboxd.addEventListener(ClickEvent, () => this.Elements.letterboxdFile.click());
    this.Elements.syncToImdb.addEventListener(ClickEvent, () => this.SyncMissingRatingsToImdb().catch((error) => this.ShowSyncError(error)));
    this.Elements.syncToLetterboxd.addEventListener(ClickEvent, () => this.DownloadLetterboxdSync().catch((error) => this.ShowSyncError(error)));
  }

  BindAccountEvents() {
    this.Elements.loginForm.addEventListener(SubmitEvent, (event) => this.HandleLogin(event));
    this.Elements.signupForm.addEventListener(SubmitEvent, (event) => this.HandleSignup(event));
    this.Elements.showLogin.addEventListener(ClickEvent, () => this.ShowAuthPanel("login"));
    this.Elements.showSignup.addEventListener(ClickEvent, () => this.ShowAuthPanel("signup"));
    this.Elements.signOut.addEventListener(ClickEvent, () => this.HandleSignOutClick());
  }

  HandleSignOutClick() {
    this.SignOut().catch((error) => this.ShowToast(EscapeHtml(error.message || "Could not sign out.")));
  }

  BindMobileEvents() {
    this.Elements.mobileHeaderToggle.addEventListener(ClickEvent, () => this.ToggleMobileHeader());
    this.Elements.mobileRatingBar.addEventListener(ClickEvent, (event) => this.HandleMobileRatingClick(event));
    this.Elements.touchNotSeen.addEventListener(ClickEvent, () => this.MarkActive(null, "notSeen"));
    this.Elements.touchUndo.addEventListener(ClickEvent, () => this.Undo());
  }

  HandleMobileRatingClick(event) {
    const button = event.target.closest("[data-touch-rating]");
    if (button)
      this.MarkActive(Number(button.dataset.touchRating), "rated");
  }

  BindHeaderMenuEvents() {
    const menus = [this.Elements.quickRateMenu, this.Elements.dataMenu, this.Elements.connectionMenu];
    for (const menu of menus)
      menu.addEventListener("toggle", () => this.HandleHeaderToggle(menu, menus));
    document.addEventListener(ClickEvent, (event) => this.HandleHeaderDocumentClick(event, menus));
    document.addEventListener(KeydownEvent, (event) => this.HandleHeaderDocumentKey(event));
  }

  HandleHeaderToggle(menu, menus) {
    if (!menu.open)
      return;
    for (const other of menus)
      if (other !== menu)
        other.open = false;
  }

  HandleHeaderDocumentClick(event, menus) {
    if (!menus.some((menu) => menu.contains(event.target)))
      this.CloseHeaderMenus();
  }

  HandleHeaderDocumentKey(event) {
    if (event.key === "Escape")
      this.CloseHeaderMenus();
  }

  CloseHeaderMenus() {
    this.Elements.quickRateMenu.open = false;
    this.Elements.dataMenu.open = false;
    this.Elements.connectionMenu.open = false;
  }

  ToggleMobileHeader() {
    const expanded = this.Elements.mobileHeaderToggle.getAttribute(AriaExpandedAttribute) !== "true";
    this.Elements.mobileHeaderToggle.setAttribute(AriaExpandedAttribute, String(expanded));
    this.SetMobileProgressLabel(expanded);
    this.Elements.appHeader.classList.toggle("mobile-dashboard-open", expanded);
  }

  SetMobileProgressLabel(expanded) {
    const label = this.Elements.mobileHeaderToggle.firstElementChild;
    if (label)
      label.textContent = expanded ? "Hide progress" : "Show progress";
  }
}
