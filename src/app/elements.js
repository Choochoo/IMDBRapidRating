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
    ...BuildAccountElements(),
    ...BuildMobileElements()
  };
}

function BuildAccountElements() {
  return {
    accountBadge: Element("account-badge"),
    signOut: Element("sign-out"),
    authDialog: Element("auth-dialog"),
    loginForm: Element("login-form"),
    loginUsername: Element("login-username"),
    loginPassword: Element("login-password"),
    loginError: Element("login-error"),
    loginSubmit: Element("login-submit"),
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
    tabRater: Element("tab-rater"),
    tabAi: Element("tab-ai"),
    raterView: Element("rater-view"),
    recommendationView: Element("recommendation-view"),
    ratingFooter: Element("rating-footer")
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
    sourceBadge: Element("source-badge"),
    liveBadge: Element("live-badge"),
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
    csvFile: Element("csv-file")
  };
}

function BuildCookieElements() {
  return {
    ...BuildImdbSetupElements(),
    ...BuildTmdbSetupElements()
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
    generateRecommendations: Element("generate-recommendations"),
    recommendationStatus: Element("recommendation-status"),
    recommendationGrid: Element("recommendation-grid")
  };
}

function Element(id) {
  return document.getElementById(id);
}
