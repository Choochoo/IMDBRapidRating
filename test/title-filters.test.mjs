import assert from "node:assert/strict";
import test from "node:test";
import { FilterTitlePool } from "../server/movie-pool.mjs";
import { BuildPendingTitles, FetchTitleMetadata, FetchTmdbJson, ValidateCatalogOriginCoverage, ValidateHydrationComplete } from "../scripts/enrich-title-origins.mjs";
import {
  CountActiveTitleFilters,
  IsTitleAllowed,
  NormalizeTitleFilters,
  NormalizeTmdbOrigin
} from "../shared/title-filters.js";

const MovieId = "tt0000001";
const TvId = "tt0000002";
const ThirdTitleId = "tt0000003";
const MovieMediaType = "movie";
const TvMediaType = "tv";
const MatchedStatus = "matched";
const NotFoundStatus = "not-found";
const TestUrl = "https://example.test";
const TestApiKey = "key";
const UsCountry = "US";
const KoreaCountry = "KR";
const IndiaCountry = "IN";
const EnglishLanguage = "en";
const KoreanLanguage = "ko";
const HindiLanguage = "hi";
const TurkishLanguage = "tr";

test("title filters normalize ranges and deduplicate origin selections", VerifyTitleFilterNormalization);
test("year, country, language, Bollywood, and unknown-origin filters compose", VerifyComposedTitleFilters);
test("TMDB origin normalization combines TV origin and production countries", VerifyTmdbOriginNormalization);
test("filtered title pools get a distinct identity without mutating the catalog", VerifyFilteredTitlePool);
test("origin enrichment refuses to publish catalogs without usable metadata", VerifyCatalogOriginCoverage);
test("origin enrichment only queues titles missing from its persistent cache", VerifyOriginPendingTitles);
test("origin enrichment expires negative cache entries and rejects unresolved catalogs", VerifyIncompleteHydration);
test("TMDB enrichment caches missing title details as a negative result", VerifyMissingTmdbDetails);
test("TMDB enrichment does not retry permanent client errors", VerifyPermanentTmdbFailure);
test("TMDB enrichment retries transient server errors", VerifyTransientTmdbFailure);

function VerifyTitleFilterNormalization() {
  const input = BuildTitleFilterInput();
  const filters = NormalizeTitleFilters(input);
  assert.equal(filters.minYear, 1990);
  assert.equal(filters.maxYear, 2020);
  assert.deepEqual(filters.excludedOriginCountries, [UsCountry]);
  assert.deepEqual(filters.excludedOriginalLanguages, [EnglishLanguage]);
  assert.equal(CountActiveTitleFilters(filters), 5);
}

function BuildTitleFilterInput() {
  return {
    minYear: "2020",
    maxYear: "1990",
    excludedOriginCountries: ["us", UsCountry, "invalid"],
    excludedOriginalLanguages: ["EN", EnglishLanguage, ""],
    excludeBollywood: true,
    includeUnknownOrigin: false
  };
}

function VerifyComposedTitleFilters() {
  const filters = BuildComposedTitleFilters();
  assert.equal(IsTitleAllowed(Title(1999, [KoreaCountry], KoreanLanguage), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, [UsCountry, KoreaCountry], KoreanLanguage), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, ["TR"], TurkishLanguage), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, [IndiaCountry], HindiLanguage), filters), false);
  assert.equal(IsTitleAllowed(Title(2010, [IndiaCountry], "ta"), filters), true);
  assert.equal(IsTitleAllowed(Title(2020, [KoreaCountry], KoreanLanguage), filters), true);
  assert.equal(IsTitleAllowed(Title(2010, [], ""), filters), false);
}

function BuildComposedTitleFilters() {
  return {
    minYear: 2000,
    maxYear: 2020,
    excludedOriginCountries: [UsCountry],
    excludedOriginalLanguages: [TurkishLanguage],
    excludeBollywood: true,
    includeUnknownOrigin: false
  };
}

function VerifyTmdbOriginNormalization() {
  const details = {
    origin_country: [KoreaCountry],
    production_countries: [{ iso_3166_1: UsCountry }],
    production_companies: [{ origin_country: "JP" }]
  };
  const origin = NormalizeTmdbOrigin(TvMediaType, { original_language: "KO" }, details);
  assert.deepEqual(origin.originCountries, [KoreaCountry, UsCountry]);
  assert.equal(origin.originalLanguage, KoreanLanguage);
}

function VerifyFilteredTitlePool() {
  const titles = BuildCatalogTitles();
  const pool = { titles, ids: titles.map((title) => title.ttId), version: "unfiltered" };
  const filtered = FilterTitlePool(pool, { minYear: 2000, excludeBollywood: true });
  assert.deepEqual(filtered.ids, [TvId]);
  assert.match(filtered.version, /^[a-f0-9]{64}$/);
  assert.notEqual(filtered.version, pool.version);
  assert.deepEqual(pool.ids, [MovieId, TvId, ThirdTitleId]);
}

function BuildCatalogTitles() {
  return [
    { ttId: MovieId, year: 1995, originCountries: [UsCountry], originalLanguage: EnglishLanguage },
    { ttId: TvId, year: 2019, originCountries: [KoreaCountry], originalLanguage: KoreanLanguage },
    { ttId: ThirdTitleId, year: 2021, originCountries: [IndiaCountry], originalLanguage: HindiLanguage }
  ];
}

function VerifyCatalogOriginCoverage() {
  const { catalogs, cache } = BuildOriginCoverageFixtures();
  assert.doesNotThrow(() => ValidateCatalogOriginCoverage(catalogs, cache));
  const missingTvMetadata = { ...cache, [TvId]: { mediaType: TvMediaType, status: NotFoundStatus } };
  assert.throws(() => ValidateCatalogOriginCoverage(catalogs, missingTvMetadata), /no usable tv metadata/);
}

function BuildOriginCoverageFixtures() {
  const catalogs = [
    { mediaType: MovieMediaType, titles: [{ ttId: MovieId }] },
    { mediaType: TvMediaType, titles: [{ ttId: TvId }] }
  ];
  const cache = {
    [MovieId]: { mediaType: MovieMediaType, status: MatchedStatus, originCountries: [UsCountry], originalLanguage: EnglishLanguage },
    [TvId]: { mediaType: TvMediaType, status: MatchedStatus, originCountries: [KoreaCountry], originalLanguage: KoreanLanguage }
  };
  return { catalogs, cache };
}

function VerifyOriginPendingTitles() {
  const catalogs = [
    { mediaType: MovieMediaType, titles: [{ ttId: MovieId }, { ttId: ThirdTitleId }] },
    { mediaType: TvMediaType, titles: [{ ttId: TvId }] }
  ];
  const cache = {
    [MovieId]: { mediaType: MovieMediaType, status: MatchedStatus },
    [ThirdTitleId]: { mediaType: MovieMediaType, status: MatchedStatus, tmdbId: 303, metadataCheckedAt: "2026-07-22T12:00:00.000Z" },
    [TvId]: { mediaType: TvMediaType, status: NotFoundStatus, checkedAt: new Date().toISOString() }
  };
  assert.deepEqual(BuildPendingTitles(catalogs, cache), [{ ttId: MovieId, mediaType: MovieMediaType }]);
}

function VerifyIncompleteHydration() {
  const catalogs = [{ mediaType: MovieMediaType, titles: [{ ttId: MovieId }] }];
  const cache = { [MovieId]: { mediaType: MovieMediaType, status: NotFoundStatus, checkedAt: "2020-01-01T00:00:00.000Z" } };
  assert.deepEqual(BuildPendingTitles(catalogs, cache), [{ ttId: MovieId, mediaType: MovieMediaType }]);
  assert.throws(() => ValidateHydrationComplete(catalogs, cache), /left 1 catalog titles unresolved/);
}

async function VerifyMissingTmdbDetails() {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return requests.length === 1 ? JsonResponse({ movie_results: [{ id: 101 }] }) : ErrorResponse(404);
  };
  const result = await FetchTitleMetadata({ ttId: MovieId, mediaType: MovieMediaType }, null, TestApiKey, fetchImpl, () => {});
  assert.equal(result.status, NotFoundStatus);
  assert.equal(result.tmdbId, null);
  assert.equal(requests.length, 2);
  const catalogs = [{ mediaType: MovieMediaType, titles: [{ ttId: MovieId }] }];
  assert.doesNotThrow(() => ValidateHydrationComplete(catalogs, { [MovieId]: result }));
}

async function VerifyPermanentTmdbFailure() {
  const state = { requests: 0, delays: [] };
  const fetchImpl = async () => { state.requests++; return ErrorResponse(401); };
  await assert.rejects(() => FetchTmdbJson(TestUrl, TestApiKey, fetchImpl, (delay) => state.delays.push(delay)), /HTTP 401/);
  assert.equal(state.requests, 1);
  assert.deepEqual(state.delays, []);
}

async function VerifyTransientTmdbFailure() {
  const state = { requests: 0, delays: [] };
  const fetchImpl = async () => ++state.requests < 3 ? ErrorResponse(503) : JsonResponse({ ok: true });
  const result = await FetchTmdbJson(TestUrl, TestApiKey, fetchImpl, (delay) => state.delays.push(delay));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(state.delays, [500, 1000]);
}

function ErrorResponse(status) {
  return { ok: false, status, headers: { get: () => "" } };
}

function JsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function Title(year, originCountries, originalLanguage) {
  return { year, originCountries, originalLanguage };
}
