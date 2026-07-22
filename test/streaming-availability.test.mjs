import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateStreamingAvailabilityService,
  FetchTmdbWatchProviders,
  IsStreamingAvailabilityFresh,
  NormalizeWatchProviders
} from "../server/streaming-availability.mjs";

const Now = new Date("2026-07-22T12:00:00.000Z");

test("TMDB watch providers normalize subscription, free, ads, rental, and purchase options", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { results: { US: {
          link: "https://www.themoviedb.org/movie/101/watch?locale=US",
          flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.jpg", display_priority: 1 }],
          free: [{ provider_id: 2, provider_name: "Freevee", logo_path: "/freevee.jpg", display_priority: 3 }],
          ads: [{ provider_id: 3, provider_name: "Tubi", logo_path: "/tubi.jpg", display_priority: 2 }],
          rent: [{ provider_id: 10, provider_name: "Apple TV", logo_path: "/apple.jpg", display_priority: 4 }],
          buy: [{ provider_id: 10, provider_name: "Apple TV", logo_path: "/apple.jpg", display_priority: 4 }]
        } } };
      }
    };
  };

  const result = await FetchTmdbWatchProviders("movie", 101, "api-key", "US", { fetchImpl, now: () => Now });

  assert.match(calls[0].url, /\/movie\/101\/watch\/providers\?api_key=api-key$/);
  assert.deepEqual(result.providers.map((provider) => provider.type), ["subscription", "ads", "free", "rent", "buy"]);
  assert.equal(result.fetchedAt, Now.toISOString());
});

test("watch provider normalization rejects unusable IDs, names, and logo paths", () => {
  assert.deepEqual(NormalizeWatchProviders("subscription", [
    { provider_id: 8, provider_name: " Netflix ", logo_path: "/netflix.jpg", display_priority: 1 },
    { provider_id: 0, provider_name: "Invalid" },
    { provider_id: 9, provider_name: "", logo_path: "/blank.jpg" },
    { provider_id: 10, provider_name: "Unsafe Logo", logo_path: "/../secret" }
  ]), [
    { type: "subscription", id: 8, name: "Netflix", logoPath: "/netflix.jpg", displayPriority: 1 },
    { type: "subscription", id: 10, name: "Unsafe Logo", logoPath: "", displayPriority: 0 }
  ]);
  assert.deepEqual(NormalizeWatchProviders("unknown", [{ provider_id: 8, provider_name: "Netflix" }]), []);
});

test("streaming availability cache returns fresh data without a request", async () => {
  let fetchCount = 0;
  const service = CreateStreamingAvailabilityService({ fetchImpl: async () => { fetchCount++; }, now: () => Now });
  const cached = { country: "US", fetchedAt: "2026-07-22T06:00:00.000Z", watchUrl: "", providers: [] };

  const result = await service.get({ mediaType: "movie", tmdbId: 101, apiKey: "key", country: "US", cached });

  assert.equal(fetchCount, 0);
  assert.equal(result.stale, false);
  assert.equal(IsStreamingAvailabilityFresh(result, Now), true);
});

test("stale availability returns immediately and deduplicates its background refresh", async () => {
  let fetchCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => {
    fetchCount++;
    await gate;
    return { ok: true, json: async () => ({ results: { US: { flatrate: [] } } }) };
  };
  const service = CreateStreamingAvailabilityService({ fetchImpl, now: () => Now });
  const cached = { country: "US", fetchedAt: "2026-07-20T06:00:00.000Z", watchUrl: "", providers: [] };
  const request = { mediaType: "movie", tmdbId: 101, apiKey: "key", country: "US", cached };

  const [first, second] = await Promise.all([service.get(request), service.get(request)]);
  assert.equal(first.stale, true);
  assert.equal(second.stale, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);
  release();
});
