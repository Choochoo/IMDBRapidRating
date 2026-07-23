const DataUrls = { movie: "/data/movies.json", tv: "/data/shows.json" };
Object.freeze(DataUrls);

export const Config = {
  visibleCount: 3,
  storageKey: "imdb-rapid-rater-v4",
  settingsKey: "imdb-rapid-rater-browser-settings-v1",
  animationMs: 110,
  dataUrls: DataUrls,
  liveStatusUrl: "/api/imdb/status",
  aiStatusUrl: "/api/ai/status",
  aiModelsUrl: "/api/ai/models",
  aiSettingsUrl: "/api/ai/settings",
  recommendationsUrl: "/api/ai/recommendations",
  recommendationQueueUrl: "/api/ai/recommendations/queue",
  recommendationExclusionsUrl: "/api/account/recommendation-exclusions",
  raterQueueUrl: "/api/rater/queue",
  raterDecisionUrl: "/api/rater/decision",
  quickRatingUrl: "/api/rater/quick-rating",
  raterUndoUrl: "/api/rater/undo",
  raterEventsUrl: "/api/rater/events",
  titleMetadataUrl: "/api/title/",
  rateUrl: "/api/rate",
  imdbRetryUrl: "/api/imdb/retry",
  notSeenUrl: "/api/account/not-seen"
};
Object.freeze(Config);
