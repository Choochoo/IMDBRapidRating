export const Config = Object.freeze({
  visibleCount: 3,
  storageKey: "imdb-rapid-rater-v4",
  animationMs: 150,
  dataUrl: "./data/movies.json",
  liveStatusUrl: "./api/imdb/status",
  cookieUrl: "./api/imdb/cookie",
  tmdbKeyUrl: "./api/tmdb/key",
  ratingsCsvUrl: "./api/imdb/ratings-csv",
  titleMetadataUrl: "./api/title/",
  rateUrl: "./api/rate",
  submitDelayMs: 750,
  skipKey: "`",
  ratingKeys: Object.freeze({
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9
  })
});
