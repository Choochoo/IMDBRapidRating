import assert from "node:assert/strict";
import test from "node:test";
import { GetTitleMetadata, NormalizeTrailerUrl, PickTmdbTrailerUrl, ReadActorNames } from "../server/title-metadata.mjs";

const MovieMediaType = "movie";
const TmdbSource = "tmdb";
const Country = "US";
const ApiKey = "api-key";
const OldTimestamp = "2026-05-01T12:00:00.000Z";
const TestRunId = Date.now();
const TmdbSynopsis = "TMDB synopsis.";
const StoredSynopsis = "Stored locally.";
const ActorName = "Actor One";
const NetflixName = "Netflix";
const TmdbHost = "api.themoviedb.org";
const ImdbTitleHost = "imdb.com/title";
const PosterUrl = "https://image.tmdb.org/t/p/w342/poster.jpg";
const TmdbDetailsData = {
  id: 101,
  poster_path: "/poster.jpg",
  overview: TmdbSynopsis,
  original_language: "en",
  production_countries: [{ iso_3166_1: Country }],
  credits: { cast: [{ name: ActorName }] },
  videos: { results: [{ site: "YouTube", key: "official_trailer", type: "Trailer", official: true }] }
};
const TmdbDetails = Object.freeze(TmdbDetailsData);
const StreamingService = Object.freeze({ get: async ({ cached }) => cached || null });

test("actor metadata accepts IMDb, TMDB, and text-shaped cast entries", VerifyActorShapes);
test("actor metadata removes blank and duplicate names", VerifyActorDeduplication);
test("TMDB trailer selection prefers an official trailer on YouTube", VerifyTrailerSelection);
test("trailer URLs reject non-web protocols", VerifyTrailerProtocol);
test("fresh PostgreSQL metadata and streaming availability are reused without exposing the raw TMDB payload", VerifyFreshDatabaseMetadata);
test("streaming availability is loaded only when explicitly requested", VerifyStreamingAvailabilityOptIn);
test("IMDb fallback metadata is hydrated when a TMDB key becomes available", VerifyFallbackUpgrade);
test("TMDB find results never cross movie and TV media types", VerifyExpectedTmdbMediaType);
test("failed TMDB refreshes retain the previous freshness timestamp", VerifyFailedRefreshTimestamp);
test("fresh partial TMDB records observe their normal cache TTL", VerifyPartialTmdbCache);
test("concurrent metadata misses share one outbound metadata load", VerifyMetadataSingleFlight);
test("cold metadata requests recover when every source rejects", VerifyAllSourceRecovery);

function VerifyActorShapes() {
  const actors = [{ "@type": "Person", name: "Al Pacino" }, { id: 380, name: "Robert De Niro" }, "Val Kilmer", { name: "Jon Voight" }];
  assert.deepEqual(ReadActorNames(actors), ["Al Pacino", "Robert De Niro", "Val Kilmer"]);
}

function VerifyActorDeduplication() {
  assert.deepEqual(ReadActorNames(["Amy Adams", "", {}, { name: "Amy Adams" }, { name: "Jeremy Renner" }]), ["Amy Adams", "Jeremy Renner"]);
}

function VerifyTrailerSelection() {
  const videos = [{ site: "YouTube", key: "teaser", type: "Teaser", official: true }, { site: "Vimeo", key: "ignored", type: "Trailer", official: true }, { site: "YouTube", key: "official_trailer", type: "Trailer", official: true }];
  assert.equal(PickTmdbTrailerUrl(videos), "https://www.youtube.com/watch?v=official_trailer");
}

function VerifyTrailerProtocol() {
  assert.equal(NormalizeTrailerUrl("javascript:alert(1)"), "");
  assert.equal(NormalizeTrailerUrl("https://www.imdb.com/video/vi123"), "https://www.imdb.com/video/vi123");
}

async function VerifyFreshDatabaseMetadata() {
  const titleId = TestTitleId(1);
  const availability = BuildAvailability();
  const store = CreateMemoryStore(BuildStoredMetadata(titleId, { streamingByCountry: { [Country]: availability } }));
  const result = await GetTitleMetadata(titleId, { ...BuildOptions(store, RejectUnexpectedFetch), includeStreaming: true });
  assert.equal(result.payload.synopsis, StoredSynopsis);
  assert.equal(result.payload.streamingAvailability.providers[0].name, NetflixName);
  assert.equal(Object.hasOwn(result.payload, "sourcePayload"), false);
  assert.equal(store.writes.length, 0);
}

async function VerifyStreamingAvailabilityOptIn() {
  const titleId = TestTitleId(6);
  const store = CreateMemoryStore(BuildStoredMetadata(titleId));
  const state = { calls: 0 };
  const service = { get: async () => { state.calls++; return BuildAvailability(); } };
  await GetTitleMetadata(titleId, { ...BuildOptions(store, RejectUnexpectedFetch), streamingAvailabilityService: service });
  assert.equal(state.calls, 0);
  await GetTitleMetadata(titleId, { ...BuildOptions(store, RejectUnexpectedFetch), streamingAvailabilityService: service, includeStreaming: true });
  assert.equal(state.calls, 1);
}

async function VerifyFallbackUpgrade() {
  const titleId = TestTitleId(2);
  const store = CreateMemoryStore(BuildOriginMetadata(titleId));
  await GetTitleMetadata(titleId, BuildOptions(store, CreateMetadataFetch({ urls: [] })));
  assert.equal(store.value.source, "imdb-title-page");
  assert.equal(store.value.metadataCheckedAt, "");
  const state = { urls: [] };
  const result = await GetTitleMetadata(titleId, { ...BuildOptions(store, CreateMetadataFetch(state)), tmdbApiKey: ApiKey });
  assert.equal(result.payload.source, TmdbSource);
  assert.equal(result.payload.synopsis, TmdbSynopsis);
  assert.equal(state.urls.filter((url) => url.includes(TmdbHost)).length, 1);
}

async function VerifyExpectedTmdbMediaType() {
  const titleId = TestTitleId(7);
  const store = CreateMemoryStore({ ...BuildOriginMetadata(titleId), mediaType: "tv", tmdbId: null });
  const state = { urls: [] };
  const result = await GetTitleMetadata(titleId, { ...BuildOptions(store, CreateCrossMediaFetch(state)), mediaType: "tv", tmdbApiKey: ApiKey });
  assert.notEqual(result.payload.source, TmdbSource);
  assert.equal(result.payload.tmdbId, null);
  assert.equal(state.urls.some((url) => /api\.themoviedb\.org\/3\/movie\/202/.test(url)), false);
}

async function VerifyFailedRefreshTimestamp() {
  const titleId = TestTitleId(3);
  const store = CreateMemoryStore(BuildStoredMetadata(titleId, { metadataCheckedAt: OldTimestamp }));
  const options = { ...BuildOptions(store, CreateMetadataFetch({ urls: [] }, false)), tmdbApiKey: ApiKey };
  const result = await GetTitleMetadata(titleId, options);
  assert.equal(result.payload.synopsis, StoredSynopsis);
  assert.equal(store.writes.at(-1).metadataCheckedAt, OldTimestamp);
  assert.equal(store.writes.at(-1).source, TmdbSource);
}

async function VerifyPartialTmdbCache() {
  const titleId = TestTitleId(4);
  const store = CreateMemoryStore(BuildStoredMetadata(titleId, { posterUrl: "" }));
  const state = { fetchCount: 0 };
  const result = await GetTitleMetadata(titleId, { ...BuildOptions(store, async () => { state.fetchCount++; }), tmdbApiKey: ApiKey });
  assert.equal(result.payload.synopsis, StoredSynopsis);
  assert.equal(state.fetchCount, 0);
  assert.equal(store.writes.length, 0);
}

async function VerifyMetadataSingleFlight() {
  const titleId = TestTitleId(5);
  const store = CreateMemoryStore(BuildOriginMetadata(titleId));
  const gate = CreateDeferred();
  const state = { urls: [], gate };
  const options = { ...BuildOptions(store, CreateMetadataFetch(state)), tmdbApiKey: ApiKey };
  const requests = [GetTitleMetadata(titleId, options), GetTitleMetadata(titleId, options)];
  await WaitForTurn();
  assert.equal(state.urls.filter((url) => url.includes(TmdbHost)).length, 1);
  gate.resolve();
  const results = await Promise.all(requests);
  assert.deepEqual(results.map((result) => result.payload.synopsis), [TmdbSynopsis, TmdbSynopsis]);
}

async function VerifyAllSourceRecovery() {
  const titleId = TestTitleId(8);
  const store = CreateMemoryStore(BuildOriginMetadata(titleId));
  const options = { ...BuildOptions(store, RejectMetadataSource), tmdbApiKey: ApiKey };
  const result = await GetTitleMetadata(titleId, options);
  assert.equal(result.payload.titleId, titleId);
  assert.equal(result.payload.synopsis, "");
}

function BuildOptions(metadataStore, fetchImpl) {
  return { mediaType: MovieMediaType, metadataStore, streamingAvailabilityService: StreamingService, fetchImpl };
}

function TestTitleId(index) {
  return `tt8${TestRunId}${index}`;
}

function BuildOriginMetadata(titleId) {
  const origin = { titleId, mediaType: MovieMediaType, status: "matched", tmdbId: 101, originCountries: [Country], originalLanguage: "en", checkedAt: OldTimestamp };
  const metadata = { metadataCheckedAt: "", source: "", sourcePayload: {}, actors: [], trailerUrl: "", streamingByCountry: {} };
  return {
    ...origin,
    ...metadata
  };
}

function BuildStoredMetadata(titleId, overrides = {}) {
  const metadata = { posterUrl: PosterUrl, synopsis: StoredSynopsis, actors: [ActorName], source: TmdbSource };
  return {
    ...BuildOriginMetadata(titleId),
    ...metadata,
    sourcePayload: TmdbDetails,
    metadataCheckedAt: new Date().toISOString(),
    ...overrides
  };
}

function BuildAvailability() {
  return {
    country: Country,
    fetchedAt: new Date().toISOString(),
    watchUrl: "https://www.themoviedb.org/movie/101/watch?locale=US",
    providers: [{ type: "subscription", id: 8, name: NetflixName, logoPath: "/netflix.jpg", displayPriority: 1 }]
  };
}

function CreateMemoryStore(initial) {
  const store = { value: { ...initial }, writes: [] };
  store.readOne = async () => store.value;
  store.upsertMetadata = async (entry) => {
    store.writes.push(entry);
    store.value = { ...store.value, ...entry };
  };
  return store;
}

function CreateMetadataFetch(state, detailsSucceed = true) {
  return async (url) => {
    state.urls.push(String(url));
    if (String(url).includes(TmdbHost))
      return ReadTmdbResponse(state, detailsSucceed);
    if (String(url).includes(ImdbTitleHost))
      return HtmlResponse(BuildImdbHtml());
    return JsonResponse({ d: [] });
  };
}

function CreateCrossMediaFetch(state) {
  return async (url) => {
    state.urls.push(String(url));
    if (String(url).includes("api.themoviedb.org/3/find/"))
      return JsonResponse({ movie_results: [{ id: 202 }], tv_results: [] });
    if (String(url).includes(ImdbTitleHost))
      return HtmlResponse(BuildImdbHtml());
    return JsonResponse({ d: [] });
  };
}

async function ReadTmdbResponse(state, detailsSucceed) {
  if (state.gate)
    await state.gate.promise;
  return detailsSucceed ? JsonResponse(TmdbDetails) : { ok: false, status: 503 };
}

function BuildImdbHtml() {
  return `<script type="application/ld+json">{"@type":"Movie","description":"IMDb fallback.","image":"https://m.media-amazon.com/poster.jpg"}</script>`;
}

function JsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function HtmlResponse(payload) {
  return { ok: true, status: 200, text: async () => payload };
}

function RejectUnexpectedFetch(url) {
  throw new Error(`Unexpected fetch: ${url}`);
}

function RejectMetadataSource() {
  throw new Error("Metadata source failed.");
}

function CreateDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
  return deferred;
}

function WaitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}
