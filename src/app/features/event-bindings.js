import { AiSettingsView, AiView, ChangeEvent, ClickEvent, FriendsView, ImdbSecretType, KeydownEvent, MovieMediaType, RaterView, SettingsView, SubmitEvent, SyncView, TvMediaType } from "../app-constants.js";
import { BindRecommendationRatings } from "../recommendation-ratings.js";
import { SaveImdbConnectionFromDialog, SaveStreamingRegionFromDialog } from "../settings-workflows.js";
import { ApplyRecommendationYearFilters, ApplyTitleFilters, HideTitleFilterDialog, ResetTitleFilterDialog, ShowTitleFilterDialog, UpdateTitleFilterPreview } from "../title-filter-workflows.js";
import { EscapeHtml } from "../util.js";
import { NormalizeRecommendationBasis } from "../../../shared/recommendation-basis.js";
import { IsLoginPath, LoginPath, PathForView, RouteFromPathname } from "../view-routes.js";

const EscapeKey = "Escape";
const InputEvent = "input";
const NotSeenAction = "not-seen";
const NotSeenDecision = "notSeen";
const RatedDecision = "rated";
const ToggleEvent = "toggle";
const UndoAction = "undo";

export class EventBindingsFeature {
  BindEvents() {
    this.BindPrimaryEvents();
    this.BindSecondaryEvents();
  }

  BindPrimaryEvents() {
    this.BindViewEvents();
    this.BindRaterEvents();
    this.BindQuickRateEvents();
    this.BindToolbarEvents();
    this.BindSetupEvents();
    this.BindAiEvents();
    this.BindSyncEvents();
  }

  BindSecondaryEvents() {
    this.BindFileEvents();
    this.BindAccountEvents();
    this.BindFriendEvents();
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
    this.BindViewLink(this.Elements.tabFriends, FriendsView);
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
    if (!this.CanLeaveShortcutSettings(view))
      return;
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
    if (!this.User)
      return this.ApplyAnonymousBrowserRoute(route);
    if (!this.CanApplyBrowserRoute(route))
      return;
    if (route.mediaType !== this.State.mediaType)
      return this.ActivateMedia(route.mediaType, route.view);
    this.ShowView(route.view);
  }

  ApplyAnonymousBrowserRoute(route) {
    this.PendingRoute = route;
    if (!IsLoginPath(window.location.pathname))
      window.history.replaceState({}, "", LoginPath);
  }

  CanApplyBrowserRoute(route) {
    if (this.CanLeaveShortcutSettings(route.view))
      return true;
    const view = this.State.activeView;
    const mediaType = this.State.mediaType;
    window.history.pushState({ view, mediaType }, "", PathForView(view, mediaType));
    return false;
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
    this.BindSetupGuideEvents();
    this.BindHelpReminderSystem();
    this.BindFilterEvents();
    this.BindImdbSetupEvents();
    this.BindRegionSetupEvents();
    this.BindSettingsEvents();
  }

  BindSettingsEvents() {
    this.BindHeaderAction("open-settings", () => this.NavigateToSettings(SettingsView));
    this.Elements.settingsBack.addEventListener(ClickEvent, () => this.CloseSettings());
    this.BindViewLink(this.Elements.settingsShortcutsNav, SettingsView);
    this.BindViewLink(this.Elements.settingsConnectionsNav, AiSettingsView);
    this.Elements.shortcutSettingsList.addEventListener(ClickEvent, (event) => this.HandleShortcutListClick(event));
    this.Elements.shortcutSettingsList.addEventListener(KeydownEvent, (event) => this.HandleShortcutCaptureKey(event));
    this.Elements.shortcutReset.addEventListener(ClickEvent, () => this.ResetShortcutSettings());
    this.Elements.shortcutSave.addEventListener(ClickEvent, () => this.HandleShortcutSave());
    this.Elements.settingsConfigureImdb.addEventListener(ClickEvent, () => this.ShowImdbDialog());
    this.Elements.settingsConfigureRegion.addEventListener(ClickEvent, () => this.ShowRegionDialog());
  }

  HandleShortcutSave() {
    this.SaveShortcutSettings().catch((error) => this.ShowShortcutSettingsStatus(error.message || "Shortcuts could not be saved."));
  }

  BindFilterEvents() {
    this.Elements.configureFilters.addEventListener(ClickEvent, () => ShowTitleFilterDialog(this));
    this.Elements.filtersClose.addEventListener(ClickEvent, () => HideTitleFilterDialog(this));
    this.Elements.filtersReset.addEventListener(ClickEvent, () => ResetTitleFilterDialog(this));
    this.Elements.filtersApply.addEventListener(ClickEvent, () => this.HandleApplyFilters());
    this.Elements.filtersDialog.addEventListener(InputEvent, () => UpdateTitleFilterPreview(this));
    this.Elements.filtersDialog.addEventListener(ChangeEvent, () => UpdateTitleFilterPreview(this));
    this.BindRecommendationFilterEvents();
  }

  BindRecommendationFilterEvents() {
    this.Elements.recommendationFilterMore.addEventListener(ClickEvent, () => ShowTitleFilterDialog(this));
    this.Elements.recommendationFilterEdit.addEventListener(ClickEvent, () => this.HandleRecommendationFilterEdit().catch((error) => this.ShowRecommendationError(error.message)));
  }

  async HandleRecommendationFilterEdit() {
    if (!await ApplyRecommendationYearFilters(this))
      return;
    ShowTitleFilterDialog(this);
  }

  HandleApplyFilters() {
    ApplyTitleFilters(this).catch((error) => this.ShowFilterError(error));
  }

  ShowFilterError(error) {
    this.Elements.filterError.textContent = error.message || "Filters could not be applied.";
  }

  BindImdbSetupEvents() {
    this.BindHeaderAction("configure-imdb", () => this.ShowImdbDialog());
    this.Elements.imdbClose.addEventListener(ClickEvent, () => this.HideImdbDialog());
    this.Elements.imdbSave.addEventListener(ClickEvent, () => SaveImdbConnectionFromDialog(this).catch((error) => this.ShowImdbError(error.message)));
    this.Elements.imdbDelete.addEventListener(ClickEvent, () => this.DeleteAccountSecret(ImdbSecretType));
  }

  BindRegionSetupEvents() {
    this.BindHeaderAction("configure-region", () => this.ShowRegionDialog());
    this.Elements.regionClose.addEventListener(ClickEvent, () => this.HideRegionDialog());
    this.Elements.regionSave.addEventListener(ClickEvent, () => SaveStreamingRegionFromDialog(this).catch((error) => this.ShowRegionError(error.message)));
  }

  BindAiEvents() {
    this.BindAiConfigurationEvents();
    this.BindRecommendationGenerationEvents();
    this.BindRecommendationDetailsEvents();
    BindRecommendationRatings(this);
  }

  BindAiConfigurationEvents() {
    this.Elements.configureAi.addEventListener(ClickEvent, () => this.OpenAiSettings());
    this.BindHeaderAction("configure-ai-service", () => this.OpenAiSettings());
    this.Elements.aiFindModels.addEventListener(ClickEvent, () => this.HandleFindAiModels());
    this.Elements.aiSave.addEventListener(ClickEvent, () => this.HandleAiSaveClick());
    this.Elements.aiDelete.addEventListener(ClickEvent, () => this.HandleRemoveAiSettings());
    this.Elements.aiBaseUrl.addEventListener(InputEvent, () => this.HandleAiConnectionInput());
    this.Elements.aiApiKey.addEventListener(InputEvent, () => this.HandleAiConnectionInput());
    this.Elements.aiModelSearch.addEventListener(InputEvent, () => this.FilterAiModels());
    this.Elements.aiModelSelect.addEventListener(ChangeEvent, () => this.UpdateAiSaveButton());
  }

  BindRecommendationGenerationEvents() {
    this.Elements.generateRecommendations.addEventListener(ClickEvent, () => this.HandleRecommendationClick());
    this.Elements.recommendationBasis.addEventListener(ChangeEvent, () => this.HandleRecommendationBasisChange());
    this.Elements.recommendationSort.addEventListener(ChangeEvent, () => this.HandleRecommendationSortChange());
    this.Elements.recommendationSortDirection.addEventListener(ClickEvent, () => this.ToggleRecommendationSortDirection());
  }

  BindRecommendationDetailsEvents() {
    this.Elements.recommendationDetailsClose.addEventListener(ClickEvent, () => this.HideRecommendationDetails());
    this.Elements.recommendationDetails.addEventListener(ClickEvent, (event) => this.HandleRecommendationDetailsBackdrop(event));
    document.addEventListener(KeydownEvent, (event) => this.HandleRecommendationDetailsKey(event));
  }

  HandleRecommendationDetailsBackdrop(event) {
    if (event.target === this.Elements.recommendationDetails)
      this.HideRecommendationDetails();
  }

  HandleRecommendationDetailsKey(event) {
    if (event.key === EscapeKey && !this.Elements.recommendationDetails.hidden)
      this.HideRecommendationDetails();
  }

  HandleAiSaveClick() {
    this.SaveAiSettings().catch((error) => this.ShowAiSettingsError(error.message));
  }

  HandleFindAiModels() {
    this.FindAiModels().catch((error) => this.ShowAiSettingsError(error.message));
  }

  HandleRemoveAiSettings() {
    this.RemoveAiSettings().catch((error) => this.ShowAiSettingsError(error.message));
  }

  HandleRecommendationClick() {
    this.GenerateRecommendationsFromControls().catch((error) => this.ShowRecommendationError(error.message));
  }

  async GenerateRecommendationsFromControls() {
    if (!await ApplyRecommendationYearFilters(this))
      return;
    await this.GenerateRecommendations();
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

  BindFileEvents() {
    this.Elements.jsonFile.addEventListener(ChangeEvent, (event) => this.HandleJsonFile(event).catch((error) => this.ShowToast(EscapeHtml(error.message))));
    this.Elements.csvFile.addEventListener(ChangeEvent, (event) => this.HandleCsvFile(event).catch((error) => this.ShowToast(EscapeHtml(error.message))));
    this.Elements.letterboxdFile.addEventListener(ChangeEvent, (event) => this.HandleLetterboxdFile(event).catch((error) => this.ShowSyncError(error)));
  }

  BindRaterEvents() {
    this.Elements.strip.addEventListener(ClickEvent, (event) => this.HandleRaterStripClick(event));
    this.Elements.desktopRatingControls.addEventListener(ClickEvent, (event) => this.HandleDesktopRatingClick(event));
  }

  HandleDesktopRatingClick(event) {
    const ratingButton = event.target.closest?.("[data-desktop-rating]");
    if (ratingButton)
      return this.MarkActive(Number(ratingButton.dataset.desktopRating), RatedDecision);
    const action = event.target.closest?.("[data-desktop-action]")?.dataset.desktopAction;
    if (action === NotSeenAction)
      return this.MarkActive(null, NotSeenDecision);
    if (action === UndoAction)
      this.Undo().catch((error) => this.ShowToast(EscapeHtml(error.message || "Could not go back.")));
  }

  BindQuickRateEvents() {
    this.Elements.quickRateMenu.addEventListener(ToggleEvent, () => this.HandleQuickRateMenuToggle());
    this.Elements.quickRateSearch.addEventListener(InputEvent, () => this.HandleQuickRateSearchInput());
    this.Elements.quickRateSearch.addEventListener(KeydownEvent, (event) => this.HandleQuickRateSearchKey(event));
    this.Elements.quickRateResults.addEventListener(ClickEvent, (event) => this.HandleQuickRateResultsClick(event));
    this.Elements.quickRateRating.addEventListener(InputEvent, () => this.UpdateQuickRateSubmitState());
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
    this.Elements.mobileRatingBar.addEventListener(ClickEvent, (event) => this.HandleMobileRatingClick(event));
    this.Elements.touchNotSeen.addEventListener(ClickEvent, () => this.MarkActive(null, NotSeenDecision));
    this.Elements.touchUndo.addEventListener(ClickEvent, () => this.Undo());
  }

  HandleMobileRatingClick(event) {
    const button = event.target.closest("[data-touch-rating]");
    if (button)
      this.MarkActive(Number(button.dataset.touchRating), RatedDecision);
  }

  BindHeaderMenuEvents() {
    const menus = [this.Elements.quickRateMenu, this.Elements.dataMenu, this.Elements.connectionMenu];
    for (const menu of menus)
      menu.addEventListener(ToggleEvent, () => this.HandleHeaderToggle(menu, menus));
    document.addEventListener(ClickEvent, (event) => this.HandleHeaderDocumentClick(event, menus));
    document.addEventListener(KeydownEvent, (event) => this.HandleHeaderDocumentKey(event));
  }

  HandleHeaderToggle(menu, menus) {
    if (!menu.open)
      return;
    for (const other of menus)
      if (other !== menu)
        other.open = false;
    if (menu === this.Elements.connectionMenu)
      this.RefreshConnectionStatus().catch(() => null);
  }

  async RefreshConnectionStatus() {
    if (!this.User)
      return;
    await Promise.all([this.RefreshAccountStateFromServer(), this.RefreshLiveStatus()]);
  }

  HandleHeaderDocumentClick(event, menus) {
    if (!menus.some((menu) => menu.contains(event.target)))
      this.CloseHeaderMenus();
  }

  HandleHeaderDocumentKey(event) {
    if (event.key === EscapeKey)
      this.CloseHeaderMenus();
  }

  CloseHeaderMenus() {
    this.Elements.quickRateMenu.open = false;
    this.Elements.dataMenu.open = false;
    this.Elements.connectionMenu.open = false;
  }

}
