import assert from "node:assert/strict";
import test from "node:test";
import { CreateTitleMetadataStore } from "../server/title-metadata-store.mjs";

const MovieMediaType = "movie";
const TvMediaType = "tv";
const MovieTitleId = "tt0000001";
const TvTitleId = "tt0000002";
const Country = "US";
const CheckedAt = "2026-07-22T12:34:56.000Z";
const MatchedStatus = "matched";
const EnglishLanguage = "en";
const PosterUrl = "https://image.tmdb.org/poster.jpg";
const Synopsis = "A movie.";
const ActorName = "Actor One";
const TmdbSource = "tmdb";
const DatabaseRowData = {
  tt_id: MovieTitleId,
  media_type: MovieMediaType,
  status: MatchedStatus,
  tmdb_id: 101,
  origin_countries: [Country],
  original_language: EnglishLanguage,
  checked_at: CheckedAt,
  poster_url: PosterUrl,
  synopsis: Synopsis,
  actors: [ActorName],
  trailer_url: "",
  series_status: "",
  season_count: 0,
  episode_count: 0,
  episode_runtime_minutes: 0,
  metadata_source: TmdbSource,
  source_payload: { id: 101, title: Synopsis },
  metadata_checked_at: CheckedAt,
  streaming_availability: {}
};
const OriginEntryData = {
  ttId: MovieTitleId,
  mediaType: MovieMediaType,
  status: MatchedStatus,
  tmdbId: 101,
  originCountries: [Country],
  originalLanguage: EnglishLanguage,
  checkedAt: CheckedAt
};
const MetadataEntryData = {
  titleId: MovieTitleId,
  mediaType: MovieMediaType,
  tmdbId: 101,
  originCountries: [Country],
  originalLanguage: EnglishLanguage,
  posterUrl: PosterUrl,
  synopsis: Synopsis,
  actors: [ActorName],
  source: TmdbSource,
  sourcePayload: { id: 101, title: Synopsis, credits: { cast: [] } },
  metadataCheckedAt: CheckedAt
};
const DatabaseRow = Object.freeze(DatabaseRowData);
const OriginEntry = Object.freeze(OriginEntryData);
const MetadataEntry = Object.freeze(MetadataEntryData);
const Availability = Object.freeze({ country: Country, fetchedAt: CheckedAt, watchUrl: "https://www.themoviedb.org/movie/101/watch", providers: [] });

test("PostgreSQL metadata cache reads only requested movie and TV title IDs", VerifyTargetedReads);
test("PostgreSQL metadata cache upserts origin checkpoint batches", VerifyOriginUpsert);
test("hydration-state reads remain lightweight and expose the metadata checkpoint", VerifyHydrationStateRead);
test("metadata batches preserve richer TMDB rows and retain null fallback freshness", VerifyMetadataBatchUpsert);
test("PostgreSQL metadata cache stores country availability", VerifyStreamingUpdate);

async function VerifyTargetedReads() {
  const recording = CreateReadPool();
  const cache = await CreateTitleMetadataStore(recording.pool).read([{ ttId: MovieTitleId, mediaType: MovieMediaType }, { ttId: MovieTitleId, mediaType: MovieMediaType }, { ttId: TvTitleId, mediaType: TvMediaType }]);
  assert.equal(cache[MovieTitleId].tmdbId, 101);
  assert.equal(cache[MovieTitleId].synopsis, Synopsis);
  assert.deepEqual(cache[MovieTitleId].actors, [ActorName]);
  assert.equal(cache[MovieTitleId].sourcePayload.id, 101);
  assert.deepEqual(recording.calls.map((call) => call.parameters), [[MovieMediaType, [MovieTitleId]], [TvMediaType, [TvTitleId]]]);
}

async function VerifyOriginUpsert() {
  const recording = CreateWritePool();
  const count = await CreateTitleMetadataStore(recording.pool).upsertOrigins([OriginEntry]);
  assert.equal(count, 1);
  assert.match(recording.calls[0].sql, /ON CONFLICT \(tt_id, media_type\) DO UPDATE/);
  assert.equal(JSON.parse(recording.calls[0].parameters[0])[0].tmdb_id, 101);
}

async function VerifyHydrationStateRead() {
  const recording = CreateReadPool();
  const cache = await CreateTitleMetadataStore(recording.pool).readHydrationState([{ ttId: MovieTitleId, mediaType: MovieMediaType }]);
  assert.equal(cache[MovieTitleId].metadataCheckedAt, CheckedAt);
  assert.match(recording.calls[0].sql, /metadata_checked_at/);
  assert.doesNotMatch(recording.calls[0].sql, /source_payload|streaming_availability|poster_url/);
}

async function VerifyMetadataBatchUpsert() {
  const recording = CreateWritePool();
  const fallback = { ...MetadataEntry, source: "imdb-title-page", sourcePayload: {}, metadataCheckedAt: "" };
  await CreateTitleMetadataStore(recording.pool).upsertMetadataBatch([MetadataEntry, fallback]);
  const records = JSON.parse(recording.calls[0].parameters[0]);
  assert.equal(records[0].synopsis, "A movie.");
  assert.equal(records[0].source_payload.id, 101);
  assert.equal(records[1].metadata_checked_at, null);
  assert.match(recording.calls[0].sql, /metadata_source <> 'tmdb' OR EXCLUDED\.metadata_source = 'tmdb'/);
}

async function VerifyStreamingUpdate() {
  const recording = CreateWritePool();
  await CreateTitleMetadataStore(recording.pool).updateStreaming(MovieTitleId, MovieMediaType, Country, Availability);
  assert.match(recording.calls[0].sql, /jsonb_set/);
  assert.deepEqual(JSON.parse(recording.calls[0].parameters[3]), Availability);
}

function CreateReadPool() {
  const calls = [];
  const pool = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rows: parameters[0] === MovieMediaType ? [DatabaseRow] : [] };
  } };
  return { calls, pool };
}

function CreateWritePool() {
  const calls = [];
  const pool = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rows: [], rowCount: 1 };
  } };
  return { calls, pool };
}
