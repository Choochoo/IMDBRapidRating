export function BuildElements() {
  return {
    ...BuildPrimaryElements(),
    ...BuildSecondaryElements()
  };
}

function BuildPrimaryElements() {
  return {
    strip: Element("movie-strip"),
    ...BuildViewElements(),
    ...BuildCounterElements(),
    ...BuildStatusElements(),
    ...BuildEmptyElements(),
    ...BuildFileElements(),
    ...BuildCookieElements(),
    ...BuildAiElements()
  };
}

function BuildSecondaryElements() {
  return {
    ...BuildSyncElements(),
    ...BuildAccountElements(),
    ...BuildFriendElements(),
    ...BuildSettingsElements(),
    ...BuildSetupGuideElements(),
    ...BuildHelpReminderElements(),
    ...BuildDesktopRatingElements(),
    ...BuildMobileElements()
  };
}

function BuildDesktopRatingElements() {
  return {
    desktopRatingControls: Element("desktop-rating-controls"),
    desktopRatingButtons: Element("desktop-rating-buttons"),
    desktopNotSeen: Element("desktop-not-seen"),
    desktopUndo: Element("desktop-undo")
  };
}

function BuildAccountElements() {
  return {
    ...BuildAuthVisibilityElements(),
    ...BuildLoginElements(),
    ...BuildSignupElements(),
    ...BuildUsernameElements(),
    ...BuildMigrationElements()
  };
}

function BuildAuthVisibilityElements() {
  return {
    accountBadge: Element("account-badge"),
    signOut: Element("sign-out"),
    authLanding: Element("auth-landing"),
    loginPanel: Element("login-panel"),
    signupPanel: Element("signup-panel"),
    showLogin: Element("show-login"),
    showSignup: Element("show-signup")
  };
}

function BuildLoginElements() {
  return {
    loginForm: Element("login-form"),
    loginEmail: Element("login-email"),
    loginPassword: Element("login-password"),
    loginError: Element("login-error"),
    loginSubmit: Element("login-submit")
  };
}

function BuildSignupElements() {
  return {
    signupForm: Element("signup-form"),
    signupUsername: Element("signup-username"),
    signupEmail: Element("signup-email"),
    signupPassword: Element("signup-password"),
    signupConfirmation: Element("signup-confirmation"),
    signupError: Element("signup-error"),
    signupSubmit: Element("signup-submit")
  };
}

function BuildUsernameElements() {
  return {
    usernameDialog: Element("username-dialog"),
    usernameForm: Element("username-form"),
    usernameInput: Element("username-input"),
    usernameError: Element("username-error"),
    usernameSubmit: Element("username-submit")
  };
}

function BuildMigrationElements() {
  return {
    migrationDialog: Element("migration-dialog"),
    migrationSummary: Element("migration-summary"),
    migrationImport: Element("migration-import"),
    migrationSkip: Element("migration-skip")
  };
}

function BuildMobileElements() {
  return {
    mobileRatingBar: Element("mobile-rating-bar"),
    touchNotSeen: Element("touch-not-seen"),
    touchUndo: Element("touch-undo")
  };
}

function BuildViewElements() {
  return {
    ...BuildNavigationElements(),
    ...BuildViewSectionElements(),
    ...BuildViewCopyElements()
  };
}

function BuildNavigationElements() {
  return {
    switchMovies: Element("switch-movies"),
    switchTv: Element("switch-tv"),
    brandMode: Element("brand-mode"),
    viewTabs: Element("view-tabs"),
    tabRater: Element("tab-rater"),
    tabAi: Element("tab-ai"),
    tabSync: Element("tab-sync"),
    tabFriends: Element("tab-friends"),
    friendRequestCount: Element("friend-request-count")
  };
}

function BuildViewSectionElements() {
  return {
    raterView: Element("rater-view"),
    recommendationView: Element("recommendation-view"),
    settingsView: Element("settings-view"),
    syncView: Element("sync-view"),
    friendsView: Element("friends-view"),
    ratingFooter: Element("rating-footer"),
    recommendationTitle: Element("recommendation-title"),
    recommendationDescription: Element("recommendation-description")
  };
}

function BuildViewCopyElements() {
  return {
    watchlistTitle: Element("watchlist-title"),
    watchlistCount: Element("watchlist-count"),
    emptyTitle: Element("empty-title"),
    ratedLabel: Element("rated-label"),
    skipLabel: Element("skip-label"),
    poolLabel: Element("pool-label")
  };
}

function BuildCounterElements() {
  return {
    rated: Element("rated-count"),
    skipped: Element("skip-count"),
    imported: Element("imported-count"),
    sent: Element("sent-count"),
    failed: Element("failed-count"),
    poolStatus: Element("pool-status")
  };
}

function BuildStatusElements() {
  return {
    ...BuildConnectionStatusElements(),
    ...BuildFailureStatusElements()
  };
}

function BuildConnectionStatusElements() {
  return {
    ...BuildFilterControlElements(),
    ...BuildQuickRateElements(),
    ...BuildConnectionOverviewElements(),
    ...BuildServiceStatusElements()
  };
}

function BuildFilterControlElements() {
  return {
    configureFilters: Element("configure-filters"),
    filterActiveCount: Element("filter-active-count")
  };
}

function BuildQuickRateElements() {
  return {
    quickRateMenu: Element("quick-rate-menu"),
    quickRateForm: Element("quick-rate-form"),
    quickRateSearch: Element("quick-rate-search"),
    quickRateResults: Element("quick-rate-results"),
    quickRateSelection: Element("quick-rate-selection"),
    quickRateRating: Element("quick-rate-rating"),
    quickRateError: Element("quick-rate-error"),
    quickRateSubmit: Element("quick-rate-submit")
  };
}

function BuildConnectionOverviewElements() {
  return {
    dataMenu: Element("data-menu"),
    connectionMenu: Element("connection-menu"),
    connectionSummary: Element("connection-summary"),
    connectionSummaryLabel: Element("connection-summary-label"),
    connectionMenuHeading: Element("connection-menu-heading")
  };
}

function BuildServiceStatusElements() {
  return {
    sourceBadge: Element("source-badge"),
    sourceStatusRow: Element("source-status-row"),
    liveBadge: Element("live-badge"),
    liveStatusRow: Element("live-status-row"),
    imdbStatusLabel: Element("imdb-status-label"),
    regionStatusLabel: Element("region-status-label"),
    aiStatusLabel: Element("ai-status-label")
  };
}

function BuildFailureStatusElements() {
  return {
    retryFailed: Element("retry-failed"),
    failureRetry: Element("failure-retry"),
    failurePanel: Element("failure-panel"),
    failureList: Element("failure-list"),
    toast: Element("toast")
  };
}

function BuildEmptyElements() {
  return {
    empty: Element("empty-state"),
    emptySummary: Element("empty-summary")
  };
}

function BuildFileElements() {
  return {
    jsonFile: Element("json-file"),
    csvFile: Element("csv-file"),
    letterboxdFile: Element("letterboxd-file")
  };
}

function BuildSyncElements() {
  return {
    ...BuildSyncActionElements(),
    ...BuildSyncCountElements(),
    ...BuildSyncDetailElements()
  };
}

function BuildSyncActionElements() {
  return {
    syncImportImdb: Element("sync-import-imdb"),
    syncImportLetterboxd: Element("sync-import-letterboxd"),
    syncToImdb: Element("sync-to-imdb"),
    syncToLetterboxd: Element("sync-to-letterboxd"),
    syncImdbGuide: Element("sync-imdb-guide"),
    syncLetterboxdGuide: Element("sync-letterboxd-guide"),
    syncToImdbGuide: Element("sync-to-imdb-guide"),
    syncToLetterboxdGuide: Element("sync-to-letterboxd-guide"),
    syncStatus: Element("sync-status"),
    syncSource: Element("sync-source")
  };
}

function BuildSyncCountElements() {
  return {
    syncImdbCount: Element("sync-imdb-count"),
    syncLetterboxdCount: Element("sync-letterboxd-count"),
    syncMatchedCount: Element("sync-matched-count"),
    syncToImdbCount: Element("sync-to-imdb-count"),
    syncToLetterboxdCount: Element("sync-to-letterboxd-count"),
    syncConflictCount: Element("sync-conflict-count"),
    syncUnmatchedCount: Element("sync-unmatched-count"),
    syncWatchedOnlyCount: Element("sync-watched-only-count")
  };
}

function BuildSyncDetailElements() {
  return {
    syncConflictList: Element("sync-conflict-list"),
    syncUnmatchedList: Element("sync-unmatched-list")
  };
}

function BuildCookieElements() {
  return {
    ...BuildFilterElements(),
    ...BuildImdbSetupElements(),
    ...BuildRegionSetupElements()
  };
}

function BuildFilterElements() {
  return {
    ...BuildFilterDialogElements(),
    ...BuildFilterInputElements(),
    ...BuildFilterActionElements()
  };
}

function BuildFilterDialogElements() {
  return {
    filtersDialog: Element("filters-dialog"),
    filtersTitle: Element("filters-title"),
    filtersDescription: Element("filters-description"),
    filtersClose: Element("filters-close")
  };
}

function BuildFilterInputElements() {
  return {
    ...BuildFilterRangeElements(),
    ...BuildFilterOriginElements(),
    filterPreview: Element("filter-preview"),
    filterError: Element("filter-error")
  };
}

function BuildFilterRangeElements() {
  return {
    filterMinYear: Element("filter-min-year"),
    filterMaxYear: Element("filter-max-year"),
    filterDocumentaryMode: Element("filter-documentary-mode"),
    filterMinRating: Element("filter-min-rating"),
    filterMaxRuntime: Element("filter-max-runtime")
  };
}

function BuildFilterOriginElements() {
  return {
    filterGenreOptions: Element("filter-genre-options"),
    filterCountryOptions: Element("filter-country-options"),
    filterLanguageOptions: Element("filter-language-options"),
    filterGenreSummary: Element("filter-genre-summary"),
    filterCountrySummary: Element("filter-country-summary"),
    filterLanguageSummary: Element("filter-language-summary"),
    filterBollywood: Element("filter-bollywood"),
    filterIncludeUnknown: Element("filter-include-unknown"),
    filterOriginNote: Element("filter-origin-note")
  };
}

function BuildFilterActionElements() {
  return {
    filtersReset: Element("filters-reset"),
    filtersApply: Element("filters-apply")
  };
}

function BuildImdbSetupElements() {
  return {
    configureImdb: Element("configure-imdb"),
    imdbDialog: Element("imdb-dialog"),
    imdbInput: Element("imdb-cookie-input"),
    imdbError: Element("imdb-error"),
    imdbClose: Element("imdb-close"),
    imdbShowSteps: Element("imdb-show-steps"),
    imdbSave: Element("imdb-save"),
    imdbDelete: Element("imdb-delete")
  };
}

function BuildRegionSetupElements() {
  return {
    configureRegion: Element("configure-region"),
    regionDialog: Element("region-dialog"),
    regionCountry: Element("region-country-input"),
    regionError: Element("region-error"),
    regionSave: Element("region-save"),
    regionClose: Element("region-close")
  };
}

function BuildAiElements() {
  return {
    ...BuildAiSettingsElements(),
    ...BuildRecommendationElements()
  };
}

function BuildAiSettingsElements() {
  return {
    ...BuildAiConnectionElements(),
    ...BuildAiModelElements(),
    ...BuildAiSettingsActionElements()
  };
}

function BuildAiConnectionElements() {
  return {
    configureAi: Element("configure-ai"),
    configureAiService: Element("configure-ai-service"),
    aiShowSteps: Element("ai-show-steps"),
    aiBaseUrl: Element("ai-base-url"),
    aiApiKey: Element("ai-api-key")
  };
}

function BuildAiModelElements() {
  return {
    aiFindModels: Element("ai-find-models"),
    aiModelPanel: Element("ai-model-panel"),
    aiModelSearch: Element("ai-model-search"),
    aiModelSelect: Element("ai-model-select"),
    aiModelCount: Element("ai-model-count")
  };
}

function BuildAiSettingsActionElements() {
  return {
    aiSettingsStatus: Element("ai-settings-status"),
    aiSettingsError: Element("ai-settings-error"),
    aiSave: Element("ai-save"),
    aiDelete: Element("ai-delete")
  };
}

function BuildSettingsElements() {
  return {
    ...BuildSettingsNavigationElements(),
    ...BuildShortcutSettingsElements(),
    ...BuildConnectionSettingsElements()
  };
}

function BuildSettingsNavigationElements() {
  return {
    openSettings: Element("open-settings"),
    settingsBack: Element("settings-back"),
    settingsShortcutsNav: Element("settings-shortcuts-nav"),
    settingsConnectionsNav: Element("settings-connections-nav"),
    shortcutSettingsPanel: Element("shortcut-settings-panel"),
    connectionSettingsPanel: Element("connection-settings-panel")
  };
}

function BuildShortcutSettingsElements() {
  return {
    shortcutSettingsList: Element("shortcut-settings-list"),
    shortcutSettingsStatus: Element("shortcut-settings-status"),
    shortcutReset: Element("shortcut-reset"),
    shortcutSave: Element("shortcut-save")
  };
}

function BuildConnectionSettingsElements() {
  return {
    settingsConfigureImdb: Element("settings-configure-imdb"),
    settingsConfigureRegion: Element("settings-configure-region"),
    settingsImdbStatus: Element("settings-imdb-status"),
    settingsRegionStatus: Element("settings-region-status"),
    openHelp: Element("open-help"),
    openSetupGuide: Element("open-setup-guide"),
    helpSettings: Element("help-settings"),
    helpRemindersEnabled: Element("help-reminders-enabled"),
    helpRemindersStatus: Element("help-reminders-status")
  };
}

function BuildSetupGuideElements() {
  return {
    ...BuildSetupGuideShellElements(),
    ...BuildSetupGuideCopyElements(),
    ...BuildSetupGuideStepElements()
  };
}

function BuildSetupGuideShellElements() {
  return {
    setupGuideDialog: Element("setup-guide"),
    setupGuidePanel: Element("setup-guide-panel"),
    setupGuideClose: Element("setup-guide-close"),
    setupGuideHome: Element("setup-guide-home"),
    setupGuideHub: Element("setup-guide-hub"),
    setupGuideHubList: Element("setup-guide-hub-list"),
    setupGuideStep: Element("setup-guide-step")
  };
}

function BuildSetupGuideCopyElements() {
  return {
    setupGuideProgress: Element("setup-guide-progress"),
    setupGuideTitle: Element("setup-guide-title"),
    setupGuideSummary: Element("setup-guide-summary"),
    setupGuideStepTitle: Element("setup-guide-step-title"),
    setupGuideStepBody: Element("setup-guide-step-body")
  };
}

function BuildSetupGuideStepElements() {
  return {
    setupGuideImage: Element("setup-guide-image"),
    setupGuideImageFallback: Element("setup-guide-image-fallback"),
    setupGuideAction: Element("setup-guide-action"),
    setupGuideBack: Element("setup-guide-back"),
    setupGuideNext: Element("setup-guide-next")
  };
}

function BuildHelpReminderElements() {
  return {
    helpReminder: Element("help-reminder"),
    helpReminderTitle: Element("help-reminder-title"),
    helpReminderBody: Element("help-reminder-body"),
    helpReminderOpen: Element("help-reminder-open"),
    helpReminderLater: Element("help-reminder-later"),
    helpReminderHide: Element("help-reminder-hide"),
    helpReminderSettings: Element("help-reminder-settings")
  };
}

function BuildRecommendationElements() {
  return {
    ...BuildRecommendationFilterElements(),
    ...BuildRecommendationGenerationElements(),
    ...BuildRecommendationLibraryElements(),
    ...BuildRecommendationDetailsElements(),
    recommendationStatus: Element("recommendation-status"),
    recommendationLoading: Element("recommendation-loading"),
    recommendationLoadingCopy: Element("recommendation-loading-copy")
  };
}

function BuildRecommendationGenerationElements() {
  return {
    ...BuildRecommendationRequestElements(),
    ...BuildRecommendationAudienceElements(),
    ...BuildRecommendationYearElements()
  };
}

function BuildRecommendationRequestElements() {
  return {
    generateRecommendations: Element("generate-recommendations"),
    recommendationGenerator: Element("recommendation-generator"),
    recommendationCount: Element("recommendation-count"),
    recommendationBasis: Element("recommendation-basis"),
    recommendationBasisLabel: Element("recommendation-basis-label"),
    recommendationBasisDetail: Element("recommendation-basis-detail")
  };
}

function BuildRecommendationAudienceElements() {
  return {
    recommendationAudience: Element("recommendation-audience"),
    recommendationFriendOptions: Element("recommendation-friend-options")
  };
}

function BuildRecommendationYearElements() {
  return {
    recommendationMinYear: Element("recommendation-min-year"),
    recommendationMaxYear: Element("recommendation-max-year"),
    recommendationPickFilterSummary: Element("recommendation-pick-filter-summary"),
    recommendationFilterEdit: Element("recommendation-filter-edit"),
    recommendationGeneratorFilterCount: Element("recommendation-generator-filter-count"),
    recommendationGeneratorError: Element("recommendation-generator-error")
  };
}

function BuildRecommendationLibraryElements() {
  return {
    recommendationGrid: Element("recommendation-grid"),
    recommendationSort: Element("recommendation-sort"),
    recommendationSortDirection: Element("recommendation-sort-direction")
  };
}

function BuildRecommendationDetailsElements() {
  return {
    recommendationDetails: Element("recommendation-details"),
    recommendationDetailsClose: Element("recommendation-details-close"),
    recommendationDetailsContent: Element("recommendation-details-content")
  };
}

function BuildRecommendationFilterElements() {
  return {
    recommendationFilterMore: Element("recommendation-filter-more"),
    recommendationFilterCount: Element("recommendation-filter-count"),
    socialFilterMenu: Element("social-filter-menu"),
    socialFilterMode: Element("social-filter-mode"),
    socialFilterFriends: Element("social-filter-friends")
  };
}

function BuildFriendElements() {
  return {
    ...BuildProfileElements(),
    ...BuildFriendSearchElements(),
    ...BuildFriendListElements(),
    ...BuildShareElements()
  };
}

function BuildProfileElements() {
  return {
    profileForm: Element("profile-form"),
    profileDisplayName: Element("profile-display-name"),
    profileHandle: Element("profile-handle"),
    profileSearchable: Element("profile-searchable"),
    profileShareRatings: Element("profile-share-ratings"),
    profileShowRatings: Element("profile-show-ratings"),
    profileAvatarPreview: Element("profile-avatar-preview"),
    profileAvatarFile: Element("profile-avatar-file"),
    profileAvatarRemove: Element("profile-avatar-remove"),
    profileError: Element("profile-error"),
    profileSave: Element("profile-save")
  };
}

function BuildFriendSearchElements() {
  return {
    friendSearchForm: Element("friend-search-form"),
    friendSearchInput: Element("friend-search-input"),
    friendSearchSubmit: Element("friend-search-submit"),
    friendSearchError: Element("friend-search-error"),
    friendSearchResults: Element("friend-search-results")
  };
}

function BuildFriendListElements() {
  return {
    incomingFriendsSection: Element("incoming-friends-section"),
    outgoingFriendsSection: Element("outgoing-friends-section"),
    incomingFriends: Element("incoming-friends"),
    outgoingFriends: Element("outgoing-friends"),
    acceptedFriends: Element("accepted-friends"),
    incomingFriendsCount: Element("incoming-friends-count"),
    outgoingFriendsCount: Element("outgoing-friends-count"),
    acceptedFriendsCount: Element("accepted-friends-count")
  };
}

function BuildShareElements() {
  return {
    shareDialog: Element("share-dialog"),
    shareForm: Element("share-form"),
    shareDialogTitle: Element("share-dialog-title"),
    shareFriendOptions: Element("share-friend-options"),
    shareError: Element("share-error"),
    shareSubmit: Element("share-submit"),
    shareCancel: Element("share-cancel")
  };
}

function Element(id) {
  return document.getElementById(id);
}
