import assert from "node:assert/strict";
import test from "node:test";
import { CreateTitleOriginCacheStore } from "../server/title-origin-cache.mjs";

const CheckedAt = "2026-07-22T12:34:56.000Z";

test("PostgreSQL origin cache reads only requested movie and TV title IDs", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return {
        rows: parameters[0] === "movie" ? [{
          tt_id: "tt0000001",
          media_type: "movie",
          status: "matched",
          tmdb_id: 101,
          origin_countries: ["US"],
          original_language: "en",
          checked_at: CheckedAt
        }] : []
      };
    }
  };
  const store = CreateTitleOriginCacheStore(pool);

  const cache = await store.read([
    { ttId: "tt0000001", mediaType: "movie" },
    { ttId: "tt0000001", mediaType: "movie" },
    { ttId: "tt0000002", mediaType: "tv" }
  ]);

  assert.deepEqual(cache.tt0000001, {
    mediaType: "movie",
    status: "matched",
    tmdbId: 101,
    originCountries: ["US"],
    originalLanguage: "en",
    checkedAt: CheckedAt
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].parameters, ["movie", ["tt0000001"]]);
  assert.deepEqual(calls[1].parameters, ["tv", ["tt0000002"]]);
});

test("PostgreSQL origin cache upserts checkpoint batches", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    }
  };
  const store = CreateTitleOriginCacheStore(pool);

  const count = await store.upsert([{
    ttId: "tt0000001",
    mediaType: "movie",
    status: "matched",
    tmdbId: 101,
    originCountries: ["US"],
    originalLanguage: "en",
    checkedAt: CheckedAt
  }]);

  assert.equal(count, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(tt_id, media_type\) DO UPDATE/);
  assert.deepEqual(JSON.parse(calls[0].parameters[0]), [{
    tt_id: "tt0000001",
    media_type: "movie",
    status: "matched",
    tmdb_id: 101,
    origin_countries: ["US"],
    original_language: "en",
    checked_at: CheckedAt
  }]);
});
