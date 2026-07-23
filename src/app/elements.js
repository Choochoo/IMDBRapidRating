export function BuildElements() {
  return {
    strip: Element("movie-strip"),
    ...BuildViewElements(),
    ...BuildCounterElements(),
    ...BuildStatusElements(),
    ...BuildEmptyElements(),
    ...BuildFileElements(),
    ...BuildCookieElements(),
    ...BuildAiElements(),
    ...BuildSyncElements(),
    ...BuildAccountElements(),
    ...BuildMobileElements()
  };
}

function BuildAccountElements() {
  return {
    ...BuildAuthVisibilityElements(),
    ...BuildLoginElements(),
    ...BuildSignupElements(),
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
    signupEmail: Element("signup-email"),
    signupPassword: Element("signup-password"),
    signupConfirmation: Element("signup-confirmation"),
    signupError: Element("signup-error"),
    signupSubmit: Element("signup-submit")
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
    appHeader: document.querySelector(".app-header"),
    mobileHeaderToggle: Element("mobile-header-toggle"),
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
    tabSync: Element("tab-sync")
  };
}

function BuildViewSectionElements() {
  return {
    raterView: Element("rater-view"),
    recommendationView: Element("recommendation-view"),
    syncView: Element("sync-view"),
    ratingFooter: Element("rating-footer"),
    recommendationTitle: Element("recommendation-title"),
    recommendationDescription: Element("recommendation-description")
  };
}

function BuildViewCopyElements() {
  return {
    watchlistTitle: Element("watchlist-title"),
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
    configureFilters: Element("configure-filters"),
    quickRateMenu: Element("quick-rate-menu"),
    quickRateForm: Element("quick-rate-form"),
    quickRateSearch: Element("quick-rate-search"),
    quickRateResults: Element("quick-rate-results"),
    quickRateSelection: Element("quick-rate-selection"),
    quickRateRating: Element("quick-rate-rating"),
    quickRateError: Element("quick-rate-error"),
    quickRateSubmit: Element("quick-rate-submit"),
    dataMenu: Element("data-menu"),
    connectionMenu: Element("connection-menu"),
    connectionSummary: Element("connection-summary"),
    connectionSummaryLabel: Element("connection-summary-label"),
    connectionSummaryCount: Element("connection-summary-count"),
    connectionMenuHeading: Element("connection-menu-heading"),
    sourceBadge: Element("source-badge"),
    sourceStatusRow: Element("source-status-row"),
    liveBadge: Element("live-badge"),
    liveStatusRow: Element("live-status-row"),
    imdbStatusLabel: Element("imdb-status-label"),
    tmdbStatusLabel: Element("tmdb-status-label"),
    openAiStatusLabel: Element("openai-status-label")
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
    ...BuildTmdbSetupElements()
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
    filterMinYear: Element("filter-min-year"),
    filterMaxYear: Element("filter-max-year"),
    filterGenreOptions: Element("filter-genre-options"),
    filterDocumentaryMode: Element("filter-documentary-mode"),
    filterMinRating: Element("filter-min-rating"),
    filterMaxRuntime: Element("filter-max-runtime"),
    filterCountryOptions: Element("filter-country-options"),
    filterLanguageOptions: Element("filter-language-options"),
    filterBollywood: Element("filter-bollywood"),
    filterIncludeUnknown: Element("filter-include-unknown"),
    filterOriginNote: Element("filter-origin-note"),
    filterPreview: Element("filter-preview"),
    filterError: Element("filter-error")
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
    imdbSave: Element("imdb-save"),
    imdbDelete: Element("imdb-delete")
  };
}

function BuildTmdbSetupElements() {
  return {
    configureTmdb: Element("configure-tmdb"),
    tmdbDialog: Element("tmdb-dialog"),
    tmdbInput: Element("tmdb-key-input"),
    tmdbCountry: Element("tmdb-country-input"),
    tmdbError: Element("tmdb-error"),
    tmdbSave: Element("tmdb-save"),
    tmdbClose: Element("tmdb-close"),
    tmdbLater: Element("tmdb-later"),
    tmdbDelete: Element("tmdb-delete")
  };
}

function BuildAiElements() {
  return {
    ...BuildAiDialogElements(),
    ...BuildAiModelElements(),
    ...BuildRecommendationElements()
  };
}

function BuildAiDialogElements() {
  return {
    configureAi: Element("configure-ai"),
    configureOpenAi: Element("configure-openai"),
    aiDialog: Element("ai-dialog"),
    aiInput: Element("ai-key-input"),
    aiError: Element("ai-error"),
    aiSave: Element("ai-save"),
    aiClose: Element("ai-close"),
    aiLater: Element("ai-later"),
    aiDelete: Element("ai-delete")
  };
}

function BuildAiModelElements() {
  return {
    refreshAiModels: Element("refresh-ai-models"),
    aiModelSelect: Element("ai-model-select"),
    aiModelStatus: Element("ai-model-status"),
    aiModelDetail: Element("ai-model-detail")
  };
}

function BuildRecommendationElements() {
  return {
    ...BuildRecommendationFilterElements(),
    generateRecommendations: Element("generate-recommendations"),
    toggleRecommendationPosters: Element("toggle-recommendation-posters"),
    recommendationCount: Element("recommendation-count"),
    recommendationBasis: Element("recommendation-basis"),
    recommendationBasisLabel: Element("recommendation-basis-label"),
    recommendationBasisDetail: Element("recommendation-basis-detail"),
    recommendationStatus: Element("recommendation-status"),
    recommendationLoading: Element("recommendation-loading"),
    recommendationLoadingCopy: Element("recommendation-loading-copy"),
    recommendationGrid: Element("recommendation-grid")
  };
}

function BuildRecommendationFilterElements() {
  return {
    ...BuildRecommendationFilterControlElements(),
    ...BuildRecommendationFilterActionElements()
  };
}

function BuildRecommendationFilterControlElements() {
  return {
    recommendationFilters: Element("recommendation-filter-explorer"),
    recommendationFilterYear: Element("recommendation-filter-year"),
    recommendationFilterDocumentary: Element("recommendation-filter-documentary"),
    recommendationFilterRating: Element("recommendation-filter-rating"),
    recommendationFilterRuntime: Element("recommendation-filter-runtime"),
    recommendationFilterGenres: Element("recommendation-filter-genres"),
    recommendationFilterLanguages: Element("recommendation-filter-languages"),
    recommendationFilterPreview: Element("recommendation-filter-preview")
  };
}

function BuildRecommendationFilterActionElements() {
  return {
    recommendationFilterClear: Element("recommendation-filter-clear"),
    recommendationFilterMore: Element("recommendation-filter-more"),
    recommendationFilterApply: Element("recommendation-filter-apply")
  };
}

function Element(id) {
  return document.getElementById(id);
}
