export function BuildState() {
  return {
    activeView: "rater",
    ...BuildMovieState(),
    metadata: {},
    live: BuildLiveState(),
    ai: BuildAiState(),
    locked: false,
    savedQueueIds: null
  };
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
    signature: state.signature,
    ratings: state.ratings,
    history: state.history.slice(-200),
    queueIds: state.queue.map((movie) => movie.ttId)
  };
}

function BuildMovieState() {
  return {
    movies: [],
    movieById: new Map(),
    queue: [],
    ratings: {},
    history: [],
    sourceLabel: "",
    signature: ""
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
