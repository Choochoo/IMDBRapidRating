import { ReadDatabaseSchema } from "./db/config.mjs";

const MatchedStatus = "matched";
const NotFoundStatus = "not-found";
const MetadataOnlyStatus = "metadata-only";
const SupportedOriginStatuses = new Set([MatchedStatus, NotFoundStatus]);
const SupportedMediaTypes = new Set(["movie", "tv"]);
const OriginSelectFields = "tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at";
const SelectFields = "tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at, poster_url, synopsis, actors, trailer_url, series_status, season_count, episode_count, episode_runtime_minutes, metadata_source, source_payload, metadata_checked_at, streaming_availability";

export function CreateTitleMetadataStore(pool) {
  return {
    async readOrigins(titleReferences) {
      const cache = {};
      for (const [mediaType, ttIds] of GroupTitleIds(titleReferences)) {
        const result = await pool.query(
          `SELECT ${OriginSelectFields} FROM ${QualifiedTable()} WHERE media_type=$1 AND tt_id=ANY($2::varchar[])`,
          [mediaType, ttIds]
        );
        for (const row of result.rows)
          cache[row.tt_id] = NormalizeOriginDatabaseEntry(row);
      }
      return cache;
    },

    async read(titleReferences) {
      const cache = {};
      for (const [mediaType, ttIds] of GroupTitleIds(titleReferences)) {
        const result = await pool.query(
          `SELECT ${SelectFields} FROM ${QualifiedTable()} WHERE media_type=$1 AND tt_id=ANY($2::varchar[])`,
          [mediaType, ttIds]
        );
        for (const row of result.rows)
          cache[row.tt_id] = NormalizeDatabaseEntry(row);
      }
      return cache;
    },

    async readOne(ttId, mediaType) {
      if (!IsTitleReference({ ttId, mediaType }))
        return null;
      const result = await pool.query(
        `SELECT ${SelectFields} FROM ${QualifiedTable()} WHERE tt_id=$1 AND media_type=$2 LIMIT 1`,
        [ttId, mediaType]
      );
      return result.rows[0] ? NormalizeDatabaseEntry(result.rows[0]) : null;
    },

    async upsertOrigins(entries) {
      const records = entries.map(NormalizeOriginWriteEntry).filter(Boolean);
      if (!records.length)
        return 0;
      const result = await pool.query(
        `INSERT INTO ${QualifiedTable()} (tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at, updated_at) SELECT item.tt_id, item.media_type, item.status, item.tmdb_id, item.origin_countries, item.original_language, item.checked_at, now() FROM jsonb_to_recordset($1::jsonb) AS item(tt_id varchar(32), media_type varchar(16), status varchar(16), tmdb_id integer, origin_countries jsonb, original_language varchar(16), checked_at timestamptz) ON CONFLICT (tt_id, media_type) DO UPDATE SET status=EXCLUDED.status, tmdb_id=EXCLUDED.tmdb_id, origin_countries=EXCLUDED.origin_countries, original_language=EXCLUDED.original_language, checked_at=EXCLUDED.checked_at, updated_at=now()`,
        [JSON.stringify(records)]
      );
      return result.rowCount || records.length;
    },

    async upsertMetadata(entry) {
      const record = NormalizeMetadataWriteEntry(entry);
      if (!record)
        return 0;
      const result = await pool.query(
        `INSERT INTO ${QualifiedTable()} (tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at, poster_url, synopsis, actors, trailer_url, series_status, season_count, episode_count, episode_runtime_minutes, metadata_source, source_payload, metadata_checked_at, updated_at) SELECT item.tt_id, item.media_type, CASE WHEN item.tmdb_id IS NULL THEN '${MetadataOnlyStatus}' ELSE '${MatchedStatus}' END, item.tmdb_id, item.origin_countries, item.original_language, item.metadata_checked_at, item.poster_url, item.synopsis, item.actors, item.trailer_url, item.series_status, item.season_count, item.episode_count, item.episode_runtime_minutes, item.metadata_source, item.source_payload, item.metadata_checked_at, now() FROM jsonb_to_record($1::jsonb) AS item(tt_id varchar(32), media_type varchar(16), tmdb_id integer, origin_countries jsonb, original_language varchar(16), poster_url text, synopsis text, actors jsonb, trailer_url text, series_status text, season_count integer, episode_count integer, episode_runtime_minutes integer, metadata_source varchar(32), source_payload jsonb, metadata_checked_at timestamptz) ON CONFLICT (tt_id, media_type) DO UPDATE SET status=CASE WHEN EXCLUDED.tmdb_id IS NOT NULL THEN '${MatchedStatus}' WHEN title_metadata_cache.status IN ('${MatchedStatus}', '${NotFoundStatus}') THEN title_metadata_cache.status ELSE EXCLUDED.status END, tmdb_id=COALESCE(EXCLUDED.tmdb_id, title_metadata_cache.tmdb_id), origin_countries=CASE WHEN EXCLUDED.tmdb_id IS NULL THEN title_metadata_cache.origin_countries ELSE EXCLUDED.origin_countries END, original_language=CASE WHEN EXCLUDED.tmdb_id IS NULL THEN title_metadata_cache.original_language ELSE EXCLUDED.original_language END, checked_at=CASE WHEN EXCLUDED.tmdb_id IS NULL THEN title_metadata_cache.checked_at ELSE EXCLUDED.checked_at END, poster_url=EXCLUDED.poster_url, synopsis=EXCLUDED.synopsis, actors=EXCLUDED.actors, trailer_url=EXCLUDED.trailer_url, series_status=EXCLUDED.series_status, season_count=EXCLUDED.season_count, episode_count=EXCLUDED.episode_count, episode_runtime_minutes=EXCLUDED.episode_runtime_minutes, metadata_source=EXCLUDED.metadata_source, source_payload=EXCLUDED.source_payload, metadata_checked_at=EXCLUDED.metadata_checked_at, updated_at=now()`,
        [JSON.stringify(record)]
      );
      return result.rowCount || 1;
    },

    async updateStreaming(ttId, mediaType, country, availability) {
      if (!IsTitleReference({ ttId, mediaType }) || !/^[A-Z]{2}$/.test(String(country || "")))
        return 0;
      const result = await pool.query(
        `UPDATE ${QualifiedTable()} SET streaming_availability=jsonb_set(streaming_availability, ARRAY[$3]::text[], $4::jsonb, true), updated_at=now() WHERE tt_id=$1 AND media_type=$2`,
        [ttId, mediaType, country, JSON.stringify(availability)]
      );
      return result.rowCount || 0;
    }
  };
}

function GroupTitleIds(titleReferences) {
  const groups = new Map();
  for (const item of titleReferences) {
    if (!IsTitleReference(item))
      continue;
    if (!groups.has(item.mediaType))
      groups.set(item.mediaType, new Set());
    groups.get(item.mediaType).add(item.ttId);
  }
  return [...groups].map(([mediaType, ttIds]) => [mediaType, [...ttIds]]);
}

function IsTitleReference(item) {
  return SupportedMediaTypes.has(String(item?.mediaType || "")) && /^tt\d+$/.test(String(item?.ttId || ""));
}

function NormalizeDatabaseEntry(row) {
  return {
    ...NormalizeOriginDatabaseEntry(row),
    posterUrl: String(row.poster_url || ""),
    synopsis: String(row.synopsis || ""),
    actors: Array.isArray(row.actors) ? row.actors.map(String) : [],
    trailerUrl: String(row.trailer_url || ""),
    seriesStatus: String(row.series_status || ""),
    seasonCount: Number(row.season_count) || 0,
    episodeCount: Number(row.episode_count) || 0,
    episodeRuntimeMinutes: Number(row.episode_runtime_minutes) || 0,
    source: String(row.metadata_source || ""),
    sourcePayload: IsRecord(row.source_payload) ? row.source_payload : {},
    metadataCheckedAt: ToIsoString(row.metadata_checked_at),
    streamingByCountry: IsRecord(row.streaming_availability) ? row.streaming_availability : {}
  };
}

function NormalizeOriginDatabaseEntry(row) {
  return {
    titleId: String(row.tt_id || ""),
    mediaType: String(row.media_type || ""),
    status: String(row.status || ""),
    tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
    originCountries: Array.isArray(row.origin_countries) ? row.origin_countries.map(String) : [],
    originalLanguage: String(row.original_language || ""),
    checkedAt: ToIsoString(row.checked_at)
  };
}

function NormalizeOriginWriteEntry(entry) {
  const ttId = String(entry?.ttId || "");
  const mediaType = String(entry?.mediaType || "");
  const status = String(entry?.status || "");
  if (!IsTitleReference({ ttId, mediaType }) || !SupportedOriginStatuses.has(status))
    return null;
  return {
    tt_id: ttId,
    media_type: mediaType,
    status,
    tmdb_id: Number.isInteger(entry.tmdbId) ? entry.tmdbId : null,
    origin_countries: Array.isArray(entry.originCountries) ? entry.originCountries.map(String) : [],
    original_language: String(entry.originalLanguage || ""),
    checked_at: ToIsoString(entry.checkedAt) || new Date().toISOString()
  };
}

function NormalizeMetadataWriteEntry(entry) {
  const ttId = String(entry?.titleId || entry?.ttId || "");
  const mediaType = String(entry?.mediaType || "");
  if (!IsTitleReference({ ttId, mediaType }))
    return null;
  return {
    tt_id: ttId,
    media_type: mediaType,
    tmdb_id: Number.isInteger(entry.tmdbId) ? entry.tmdbId : null,
    origin_countries: Array.isArray(entry.originCountries) ? entry.originCountries.map(String) : [],
    original_language: String(entry.originalLanguage || ""),
    poster_url: String(entry.posterUrl || ""),
    synopsis: String(entry.synopsis || ""),
    actors: Array.isArray(entry.actors) ? entry.actors.map(String).slice(0, 3) : [],
    trailer_url: String(entry.trailerUrl || ""),
    series_status: String(entry.seriesStatus || ""),
    season_count: Number(entry.seasonCount) || 0,
    episode_count: Number(entry.episodeCount) || 0,
    episode_runtime_minutes: Number(entry.episodeRuntimeMinutes) || 0,
    metadata_source: String(entry.source || "").slice(0, 32),
    source_payload: IsRecord(entry.sourcePayload) ? entry.sourcePayload : {},
    metadata_checked_at: ToIsoString(entry.metadataCheckedAt) || new Date().toISOString()
  };
}

function ToIsoString(value) {
  if (!value)
    return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function IsRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function QualifiedTable() {
  return `"${ReadDatabaseSchema()}"."title_metadata_cache"`;
}
