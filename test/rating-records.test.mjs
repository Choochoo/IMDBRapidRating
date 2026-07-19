import assert from "node:assert/strict";
import test from "node:test";
import { ImportImdbCsv } from "../src/app/rating-records.js";

test("one IMDb export is split into independent movie and TV rating collections", () => {
  const csv = [
    "Const,Your Rating,Date Rated,Title,Title Type,Year",
    "tt0113277,9,2026-07-18,Heat,Movie,1995",
    "tt0903747,10,2026-07-18,Breaking Bad,TV Series,2008",
    "tt1000001,8,2026-07-18,A Limited Series,TV Mini Series,2024",
    "tt1000002,7,2026-07-18,An Episode,TV Episode,2024"
  ].join("\n");
  const movieCatalog = new Map([["tt0113277", { ttId: "tt0113277", title: "Heat", year: 1995 }]]);
  const tvCatalog = new Map([
    ["tt0903747", { ttId: "tt0903747", title: "Breaking Bad", year: 2008 }],
    ["tt1000001", { ttId: "tt1000001", title: "A Limited Series", year: 2024 }]
  ]);
  const movieRatings = {};
  const tvRatings = {};

  ImportImdbCsv(csv, movieRatings, movieCatalog, { mediaType: "movie", otherTitleIds: new Set(tvCatalog.keys()) });
  ImportImdbCsv(csv, tvRatings, tvCatalog, { mediaType: "tv", otherTitleIds: new Set(movieCatalog.keys()) });

  assert.deepEqual(Object.keys(movieRatings), ["tt0113277"]);
  assert.deepEqual(Object.keys(tvRatings), ["tt0903747", "tt1000001"]);
  assert.equal(movieRatings.tt0113277.mediaType, "movie");
  assert.equal(tvRatings.tt0903747.mediaType, "tv");
  assert.equal("tt1000002" in tvRatings, false);
});
