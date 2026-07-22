CREATE TABLE {{schema}}.title_origin_cache (
  tt_id varchar(32) NOT NULL,
  media_type varchar(16) NOT NULL
    CHECK (media_type IN ('movie', 'tv')),
  status varchar(16) NOT NULL
    CHECK (status IN ('matched', 'not-found')),
  tmdb_id integer,
  origin_countries jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(origin_countries) = 'array'),
  original_language varchar(16) NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tt_id, media_type)
);

CREATE INDEX title_origin_cache_status_index
  ON {{schema}}.title_origin_cache (status);
