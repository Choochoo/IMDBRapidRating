import assert from "node:assert/strict";
import test from "node:test";
import { CreateTitleMetadataStore } from "../server/title-metadata-store.mjs";

const CheckedAt = "2026-07-22T12:34:56.000Z";

test("PostgreSQL metadata cache reads only requested movie and TV title IDs", async () => {
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
          checked_at: CheckedAt,
          poster_url: "https://image.tmdb.org/poster.jpg",
          synopsis: "A movie.",
          actors: ["Actor One"],
          trailer_url: "",
          series_status: "",
          season_count: 0,
          episode_count: 0,
          episode_runtime_minutes: 0,
          metadata_source: "tmdb",
          source_payload: { id: 101, title: "A movie" },
          metadata_checked_at: CheckedAt,
          streaming_availability: {}
        }] : []
      };
    }
  };
  const store = CreateTitleMetadataStore(pool);

  const cache = await store.read([
    { ttId: "tt0000001", mediaType: "movie" },
    { ttId: "tt0000001", mediaType: "movie" },
    { ttId: "tt0000002", mediaType: "tv" }
  ]);

  assert.equal(cache.tt0000001.tmdbId, 101);
  assert.equal(cache.tt0000001.synopsis, "A movie.");
  assert.deepEqual(cache.tt0000001.actors, ["Actor One"]);
  assert.equal(cache.tt0000001.sourcePayload.id, 101);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].parameters, ["movie", ["tt0000001"]]);
  assert.deepEqual(calls[1].parameters, ["tv", ["tt0000002"]]);
});

test("PostgreSQL metadata cache upserts origin checkpoint batches", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    }
  };
  const store = CreateTitleMetadataStore(pool);

  const count = await store.upsertOrigins([{
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
  assert.equal(JSON.parse(calls[0].parameters[0])[0].tmdb_id, 101);
});

test("origin builds avoid loading heavy title and streaming payload columns", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [{
        tt_id: "tt0000001",
        media_type: "movie",
        status: "matched",
        tmdb_id: 101,
        origin_countries: ["US"],
        original_language: "en",
        checked_at: CheckedAt
      }] };
    }
  };

  const cache = await CreateTitleMetadataStore(pool).readOrigins([{ ttId: "tt0000001", mediaType: "movie" }]);

  assert.equal(cache.tt0000001.status, "matched");
  assert.doesNotMatch(calls[0].sql, /source_payload|streaming_availability|poster_url/);
});

test("PostgreSQL metadata cache stores normalized title metadata and country availability", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    }
  };
  const store = CreateTitleMetadataStore(pool);
  const metadata = {
    titleId: "tt0000001",
    mediaType: "movie",
    tmdbId: 101,
    posterUrl: "https://image.tmdb.org/poster.jpg",
    synopsis: "A movie.",
    actors: ["Actor One"],
    source: "tmdb",
    sourcePayload: { id: 101, title: "A movie", credits: { cast: [] } },
    metadataCheckedAt: CheckedAt
  };
  const availability = { country: "US", fetchedAt: CheckedAt, watchUrl: "https://www.themoviedb.org/movie/101/watch", providers: [] };

  await store.upsertMetadata(metadata);
  await store.updateStreaming(metadata.titleId, metadata.mediaType, "US", availability);

  assert.equal(JSON.parse(calls[0].parameters[0]).synopsis, "A movie.");
  assert.equal(JSON.parse(calls[0].parameters[0]).source_payload.id, 101);
  assert.match(calls[1].sql, /jsonb_set/);
  assert.deepEqual(JSON.parse(calls[1].parameters[3]), availability);
});
