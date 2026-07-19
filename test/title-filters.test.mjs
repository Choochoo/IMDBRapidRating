import assert from "node:assert/strict";
import test from "node:test";
import { FilterTitlePool } from "../server/movie-pool.mjs";
import {
  CountActiveTitleFilters,
  IsTitleAllowed,
  NormalizeTitleFilters,
  NormalizeTmdbOrigin
} from "../shared/title-filters.js";

test("title filters normalize ranges and deduplicate origin selections", () => {
  const filters = NormalizeTitleFilters({
    minYear: "2020",
    maxYear: "1990",
    excludedOriginCountries: ["us", "US", "invalid"],
    excludedOriginalLanguages: ["EN", "en", ""],
    excludeBollywood: true,
    includeUnknownOrigin: false
  });

  assert.equal(filters.minYear, 1990);
  assert.equal(filters.maxYear, 2020);
  assert.deepEqual(filters.excludedOriginCountries, ["US"]);
  assert.deepEqual(filters.excludedOriginalLanguages, ["en"]);
  assert.equal(CountActiveTitleFilters(filters), 5);
});

test("year, country, language, Bollywood, and unknown-origin filters compose", () => {
  const filters = {
    minYear: 2000,
    maxYear: 2020,
    excludedOriginCountries: ["US"],
    excludedOriginalLanguages: ["tr"],
    excludeBollywood: true,
    includeUnknownOrigin: false
  };

  assert.equal(IsTitleAllowed(Title(1999, ["KR"], "ko"), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, ["US", "KR"], "ko"), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, ["TR"], "tr"), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, ["IN"], "hi"), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, ["IN"], "ta"), filters), true);
  assert.equal(IsTitleAllowed(Title(2020, ["KR"], "ko"), filters), true);
  assert.equal(IsTitleAllowed(Title(2010, [], ""), filters), false);
});

test("TMDB origin normalization combines TV origin and production countries", () => {
  const origin = NormalizeTmdbOrigin("tv", { original_language: "KO" }, {
    origin_country: ["KR"],
    production_countries: [{ iso_3166_1: "US" }],
    production_companies: [{ origin_country: "JP" }]
  });

  assert.deepEqual(origin.originCountries, ["KR", "US"]);
  assert.equal(origin.originalLanguage, "ko");
});

test("filtered title pools get a distinct identity without mutating the catalog", () => {
  const titles = [
    { ttId: "tt0000001", year: 1995, originCountries: ["US"], originalLanguage: "en" },
    { ttId: "tt0000002", year: 2019, originCountries: ["KR"], originalLanguage: "ko" },
    { ttId: "tt0000003", year: 2021, originCountries: ["IN"], originalLanguage: "hi" }
  ];
  const pool = { titles, ids: titles.map((title) => title.ttId), version: "unfiltered" };
  const filtered = FilterTitlePool(pool, { minYear: 2000, excludeBollywood: true });

  assert.deepEqual(filtered.ids, ["tt0000002"]);
  assert.match(filtered.version, /^[a-f0-9]{64}$/);
  assert.notEqual(filtered.version, pool.version);
  assert.deepEqual(pool.ids, ["tt0000001", "tt0000002", "tt0000003"]);
});

function Title(year, originCountries, originalLanguage) {
  return { year, originCountries, originalLanguage };
}
