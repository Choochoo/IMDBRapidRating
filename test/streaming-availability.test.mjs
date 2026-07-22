import assert from "node:assert/strict";
import test from "node:test";
import { CreateStreamingAvailabilityService, FetchTmdbWatchProviders, IsStreamingAvailabilityFresh, NormalizeWatchProviders } from "../server/streaming-availability.mjs";

const MovieMediaType = "movie";
const Country = "US";
const ApiKey = "api-key";
const TmdbId = 101;
const SubscriptionType = "subscription";
const NetflixName = "Netflix";
const NetflixLogoPath = "/netflix.jpg";
const AppleTvName = "Apple TV";
const AppleTvLogoPath = "/apple.jpg";
const Now = new Date("2026-07-22T12:00:00.000Z");
const FreshAvailability = Object.freeze({ country: Country, fetchedAt: "2026-07-22T06:00:00.000Z", watchUrl: "", providers: [] });
const StaleAvailability = Object.freeze({ country: Country, fetchedAt: "2026-07-20T06:00:00.000Z", watchUrl: "", providers: [] });

test("TMDB watch providers normalize subscription, free, ads, rental, and purchase options", VerifyWatchProviderFetch);
test("watch provider normalization rejects unusable IDs, names, and logo paths", VerifyProviderNormalization);
test("streaming availability cache returns fresh data without a request", VerifyFreshAvailability);
test("stale availability returns immediately and persists one deduplicated refresh", VerifyStaleRefresh);
test("stale availability survives a failed background refresh", VerifyFailedRefresh);
test("stale availability without credentials is not labeled as refreshing", VerifyKeylessStaleAvailability);

async function VerifyWatchProviderFetch() {
  const calls = [];
  const result = await FetchTmdbWatchProviders(MovieMediaType, TmdbId, ApiKey, Country, { fetchImpl: CreateProviderFetch(calls), now: () => Now });
  assert.match(calls[0].url, /\/movie\/101\/watch\/providers\?api_key=api-key$/);
  assert.deepEqual(result.providers.map((provider) => provider.type), ["subscription", "ads", "free", "rent", "buy"]);
  assert.equal(result.fetchedAt, Now.toISOString());
}

function VerifyProviderNormalization() {
  const providers = [
    { provider_id: 8, provider_name: ` ${NetflixName} `, logo_path: NetflixLogoPath, display_priority: 1 },
    { provider_id: 0, provider_name: "Invalid" },
    { provider_id: 9, provider_name: "", logo_path: "/blank.jpg" },
    { provider_id: 10, provider_name: "Unsafe Logo", logo_path: "/../secret" }
  ];
  const expected = [
    { type: SubscriptionType, id: 8, name: NetflixName, logoPath: NetflixLogoPath, displayPriority: 1 },
    { type: SubscriptionType, id: 10, name: "Unsafe Logo", logoPath: "", displayPriority: 0 }
  ];
  assert.deepEqual(NormalizeWatchProviders(SubscriptionType, providers), expected);
  assert.deepEqual(NormalizeWatchProviders("unknown", [{ provider_id: 8, provider_name: NetflixName }]), []);
}

async function VerifyFreshAvailability() {
  const state = { fetchCount: 0 };
  const service = CreateStreamingAvailabilityService({ fetchImpl: async () => { state.fetchCount++; }, now: () => Now });
  const result = await service.get(BuildRequest(FreshAvailability));
  assert.equal(state.fetchCount, 0);
  assert.equal(result.stale, false);
  assert.equal(result.refreshing, false);
  assert.equal(IsStreamingAvailabilityFresh(result, Now), true);
}

async function VerifyStaleRefresh() {
  const gate = CreateDeferred();
  const persisted = CreateDeferred();
  const state = { fetchCount: 0 };
  const service = CreateStreamingAvailabilityService({ fetchImpl: CreateDelayedFetch(state, gate), now: () => Now });
  const request = { ...BuildRequest(StaleAvailability), persist: (availability) => persisted.resolve(availability) };
  const results = await Promise.all([service.get(request), service.get(request)]);
  assert.deepEqual(results.map((result) => result.refreshing), [true, true]);
  await WaitForTurn();
  assert.equal(state.fetchCount, 1);
  gate.resolve();
  assert.equal((await persisted.promise).country, Country);
}

async function VerifyFailedRefresh() {
  const state = { persisted: false, errors: [] };
  const service = CreateStreamingAvailabilityService({ fetchImpl: async () => ({ ok: false, status: 503 }), now: () => Now, reportError: (error) => state.errors.push(error) });
  const request = { ...BuildRequest(StaleAvailability), persist: async () => { state.persisted = true; } };
  const result = await service.get(request);
  await WaitForTurn();
  assert.equal(result.stale, true);
  assert.equal(result.refreshing, true);
  assert.equal(state.persisted, false);
  assert.match(state.errors[0].message, /HTTP 503/);
}

async function VerifyKeylessStaleAvailability() {
  const service = CreateStreamingAvailabilityService({ now: () => Now });
  const result = await service.get({ ...BuildRequest(StaleAvailability), apiKey: "" });
  assert.equal(result.stale, true);
  assert.equal(result.refreshing, false);
}

function BuildRequest(cached) {
  return { mediaType: MovieMediaType, tmdbId: TmdbId, apiKey: ApiKey, country: Country, cached };
}

function CreateProviderFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => BuildProviderPayload() };
  };
}

function BuildProviderPayload() {
  const options = {
    link: "https://www.themoviedb.org/movie/101/watch?locale=US",
    flatrate: [Provider(8, NetflixName, NetflixLogoPath, 1)],
    free: [Provider(2, "Freevee", "/freevee.jpg", 3)],
    ads: [Provider(3, "Tubi", "/tubi.jpg", 2)],
    rent: [Provider(10, AppleTvName, AppleTvLogoPath, 4)],
    buy: [Provider(10, AppleTvName, AppleTvLogoPath, 4)]
  };
  return { results: { [Country]: options } };
}

function Provider(providerId, providerName, logoPath, displayPriority) {
  return { provider_id: providerId, provider_name: providerName, logo_path: logoPath, display_priority: displayPriority };
}

function CreateDelayedFetch(state, gate) {
  return async () => {
    state.fetchCount++;
    await gate.promise;
    return { ok: true, json: async () => ({ results: { [Country]: { flatrate: [] } } }) };
  };
}

function CreateDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
  return deferred;
}

function WaitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}
