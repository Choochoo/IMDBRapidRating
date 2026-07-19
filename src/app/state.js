import { NormalizeTitleFilters } from "../../shared/title-filters.js";

export function BuildState() {
  return {
    activeView: "rater",
    mediaType: "movie",
    ...BuildMovieState(),
    metadata: {},
    live: BuildLiveState(),
    ai: BuildAiState(),
    locked: false,
    savedQueueIds: null,
    queueRevision: 0,
    queuePoolVersion: "",
    queueReady: false
  };
}

export function BuildMediaState() {
  return BuildMovieState();
}

export function BuildCheckedLiveState(status) {
  return {
    checked: true,
    configured: Boolean(status.configured),
    dryRun: Boolean(status.dryRun),
    tmdbConfigured: Boolean(status.tmdbConfigured),
    submitting: false,
    lastError: status.lastError || ""
  };
}

export function BuildCheckedAiState(status) {
  return {
    checked: true,
    configured: Boolean(status.configured),
    model: status.model || "",
    modelLag: Number(status.modelLag) || 2,
    selectedModel: "",
    models: [],
    loading: false
  };
}

export function BuildStoragePayload(state) {
  return {
    ratings: state.ratings,
    recommendationExclusions: state.recommendationExclusions || [],
    letterboxd: state.letterboxd || BuildLetterboxdState(),
    history: state.history.slice(-200),
    filters: NormalizeTitleFilters(state.filters)
  };
}

function BuildMovieState() {
  return {
    movies: [],
    movieById: new Map(),
    queue: [],
    ratings: {},
    recommendationQueue: [],
    recommendationExclusions: [],
    letterboxd: BuildLetterboxdState(),
    history: [],
    filters: NormalizeTitleFilters(),
    sourceLabel: "",
    signature: ""
  };
}

function BuildLetterboxdState() {
  return {
    sourceName: "",
    importedAt: "",
    files: [],
    importedRows: 0,
    items: []
  };
}

function BuildLiveState() {
  return {
    checked: false,
    configured: false,
    dryRun: false,
    tmdbConfigured: false,
    submitting: false,
    lastError: ""
  };
}

function BuildAiState() {
  return {
    checked: false,
    configured: false,
    model: "",
    modelLag: 2,
    selectedModel: "",
    models: [],
    loading: false
  };
}
