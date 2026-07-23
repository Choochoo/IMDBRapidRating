import assert from "node:assert/strict";
import test from "node:test";
import { ImportImdbCsv } from "../src/app/rating-records.js";

const LimitedSeriesId = "tt1000001";
const MovieId = "tt0113277";
const MovieMediaType = "movie";
const TvId = "tt0903747";
const TvMediaType = "tv";

test("one IMDb export is split into independent movie and TV rating collections", VerifySplitRatingCollections);

function VerifySplitRatingCollections() {
  const csv = BuildRatingsCsv();
  const catalogs = BuildCatalogs();
  const movieRatings = {};
  const tvRatings = {};
  ImportImdbCsv(csv, movieRatings, catalogs.movie, { mediaType: MovieMediaType, otherTitleIds: new Set(catalogs.tv.keys()) });
  ImportImdbCsv(csv, tvRatings, catalogs.tv, { mediaType: TvMediaType, otherTitleIds: new Set(catalogs.movie.keys()) });
  AssertSplitRatings(movieRatings, tvRatings);
}

function BuildRatingsCsv() {
  const lines = [
    "Const,Your Rating,Date Rated,Title,Title Type,Year",
    "tt0113277,9,2026-07-18,Heat,Movie,1995",
    "tt0903747,10,2026-07-18,Breaking Bad,TV Series,2008",
    "tt1000001,8,2026-07-18,A Limited Series,TV Mini Series,2024",
    "tt1000002,7,2026-07-18,An Episode,TV Episode,2024"
  ];
  return lines.join("\n");
}

function BuildCatalogs() {
  const movieCatalog = new Map([[MovieId, { ttId: MovieId, title: "Heat", year: 1995 }]]);
  const tvCatalogEntries = [
    [TvId, { ttId: TvId, title: "Breaking Bad", year: 2008 }],
    [LimitedSeriesId, { ttId: LimitedSeriesId, title: "A Limited Series", year: 2024 }]
  ];
  return { movie: movieCatalog, tv: new Map(tvCatalogEntries) };
}

function AssertSplitRatings(movieRatings, tvRatings) {
  assert.deepEqual(Object.keys(movieRatings), [MovieId]);
  assert.deepEqual(Object.keys(tvRatings), [TvId, LimitedSeriesId]);
  assert.equal(movieRatings[MovieId].mediaType, MovieMediaType);
  assert.equal(tvRatings[TvId].mediaType, TvMediaType);
  assert.equal("tt1000002" in tvRatings, false);
}
