import { NormalizeTitleFilters } from "../../shared/title-filters.js";
import { NormalizeRecommendationBasis } from "../../shared/recommendation-basis.js";

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
    queueCounts: status.imdbQueue?.counts || {},
    submitting: false,
    lastError: status.lastError || ""
  };
}

export function BuildCheckedAiState(status) {
  return {
    checked: true,
    configured: Boolean(status.configured),
    baseUrl: String(status.baseUrl || ""),
    model: status.model || "",
    hasApiKey: Boolean(status.hasApiKey),
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
    filters: NormalizeTitleFilters(state.filters),
    recommendationBasis: NormalizeRecommendationBasis(state.recommendationBasis)
  };
}

function BuildMovieState() {
  return {
    movies: [],
    movieById: new Map(),
    queue: [],
    ratings: {},
    ...BuildRecommendationQueueState(),
    letterboxd: BuildLetterboxdState(),
    history: [],
    filters: NormalizeTitleFilters(),
    recommendationBasis: NormalizeRecommendationBasis(),
    sourceLabel: "",
    signature: ""
  };
}

function BuildRecommendationQueueState() {
  return {
    recommendationQueue: [],
    recommendationExclusions: []
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
    queueCounts: {},
    submitting: false,
    lastError: ""
  };
}

function BuildAiState() {
  return {
    checked: false,
    configured: false,
    baseUrl: "",
    model: "",
    hasApiKey: false,
    models: [],
    loading: false
  };
}
