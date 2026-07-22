ALTER TABLE {{schema}}.title_origin_cache
  RENAME TO title_metadata_cache;

ALTER INDEX {{schema}}.title_origin_cache_status_index
  RENAME TO title_metadata_cache_status_index;

ALTER TABLE {{schema}}.title_metadata_cache
  DROP CONSTRAINT IF EXISTS title_origin_cache_status_check;

ALTER TABLE {{schema}}.title_metadata_cache
  ADD CONSTRAINT title_metadata_cache_status_check
  CHECK (status IN ('matched', 'not-found', 'metadata-only')),
  ADD COLUMN poster_url text NOT NULL DEFAULT '',
  ADD COLUMN synopsis text NOT NULL DEFAULT '',
  ADD COLUMN actors jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(actors) = 'array'),
  ADD COLUMN trailer_url text NOT NULL DEFAULT '',
  ADD COLUMN series_status text NOT NULL DEFAULT '',
  ADD COLUMN season_count integer NOT NULL DEFAULT 0,
  ADD COLUMN episode_count integer NOT NULL DEFAULT 0,
  ADD COLUMN episode_runtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN metadata_source varchar(32) NOT NULL DEFAULT '',
  ADD COLUMN source_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_payload) = 'object'),
  ADD COLUMN metadata_checked_at timestamptz,
  ADD COLUMN streaming_availability jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(streaming_availability) = 'object');
