import { ReadDatabaseSchema } from "./db/config.mjs";

const MatchedStatus = "matched";
const NotFoundStatus = "not-found";
const SupportedStatuses = new Set([MatchedStatus, NotFoundStatus]);
const SupportedMediaTypes = new Set(["movie", "tv"]);

export function CreateTitleOriginCacheStore(pool) {
  return {
    async read(titleReferences) {
      const cache = {};
      for (const [mediaType, ttIds] of GroupTitleIds(titleReferences)) {
        const result = await pool.query(
          `SELECT tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at FROM ${QualifiedTable()} WHERE media_type=$1 AND tt_id=ANY($2::varchar[])`,
          [mediaType, ttIds]
        );
        for (const row of result.rows)
          cache[row.tt_id] = NormalizeDatabaseEntry(row);
      }
      return cache;
    },

    async upsert(entries) {
      const records = entries.map(NormalizeWriteEntry).filter(Boolean);
      if (!records.length)
        return 0;
      const result = await pool.query(
        `INSERT INTO ${QualifiedTable()} (tt_id, media_type, status, tmdb_id, origin_countries, original_language, checked_at, updated_at) SELECT item.tt_id, item.media_type, item.status, item.tmdb_id, item.origin_countries, item.original_language, item.checked_at, now() FROM jsonb_to_recordset($1::jsonb) AS item(tt_id varchar(32), media_type varchar(16), status varchar(16), tmdb_id integer, origin_countries jsonb, original_language varchar(16), checked_at timestamptz) ON CONFLICT (tt_id, media_type) DO UPDATE SET status=EXCLUDED.status, tmdb_id=EXCLUDED.tmdb_id, origin_countries=EXCLUDED.origin_countries, original_language=EXCLUDED.original_language, checked_at=EXCLUDED.checked_at, updated_at=now()`,
        [JSON.stringify(records)]
      );
      return result.rowCount || records.length;
    }
  };
}

function GroupTitleIds(titleReferences) {
  const groups = new Map();
  for (const item of titleReferences) {
    const mediaType = String(item?.mediaType || "");
    const ttId = String(item?.ttId || "");
    if (!SupportedMediaTypes.has(mediaType) || !ttId)
      continue;
    if (!groups.has(mediaType))
      groups.set(mediaType, new Set());
    groups.get(mediaType).add(ttId);
  }
  return [...groups].map(([mediaType, ttIds]) => [mediaType, [...ttIds]]);
}

function NormalizeDatabaseEntry(row) {
  return {
    mediaType: String(row.media_type || ""),
    status: String(row.status || ""),
    tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
    originCountries: Array.isArray(row.origin_countries) ? row.origin_countries.map(String) : [],
    originalLanguage: String(row.original_language || ""),
    checkedAt: new Date(row.checked_at).toISOString()
  };
}

function NormalizeWriteEntry(entry) {
  const ttId = String(entry?.ttId || "");
  const mediaType = String(entry?.mediaType || "");
  const status = String(entry?.status || "");
  if (!ttId || !SupportedMediaTypes.has(mediaType) || !SupportedStatuses.has(status))
    return null;
  return {
    tt_id: ttId,
    media_type: mediaType,
    status,
    tmdb_id: Number.isInteger(entry.tmdbId) ? entry.tmdbId : null,
    origin_countries: Array.isArray(entry.originCountries) ? entry.originCountries.map(String) : [],
    original_language: String(entry.originalLanguage || ""),
    checked_at: new Date(entry.checkedAt).toISOString()
  };
}

function QualifiedTable() {
  return `"${ReadDatabaseSchema()}"."title_origin_cache"`;
}
