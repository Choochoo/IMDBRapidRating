CREATE TABLE {{schema}}.imdb_rating_jobs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  media_type varchar(16) NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tt_id varchar(32) NOT NULL,
  operation varchar(16) NOT NULL DEFAULT 'rate' CHECK (operation IN ('rate', 'delete')),
  rating smallint CHECK (rating BETWEEN 1 AND 10),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'auth_required')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_http_status integer,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT imdb_rating_jobs_operation_rating CHECK ((operation = 'rate' AND rating IS NOT NULL) OR (operation = 'delete' AND rating IS NULL)),
  CONSTRAINT imdb_rating_jobs_user_media_title_unique UNIQUE (user_id, media_type, tt_id)
);

CREATE INDEX imdb_rating_jobs_dispatch
  ON {{schema}}.imdb_rating_jobs (available_at, id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX imdb_rating_jobs_user_status
  ON {{schema}}.imdb_rating_jobs (user_id, media_type, status);

CREATE TABLE {{schema}}.imdb_rating_dispatch_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  maximum_rps numeric(8, 3) NOT NULL DEFAULT 10 CHECK (maximum_rps > 0),
  current_rps numeric(8, 3) NOT NULL DEFAULT 10 CHECK (current_rps > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  success_streak integer NOT NULL DEFAULT 0 CHECK (success_streak >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO {{schema}}.imdb_rating_dispatch_state (singleton) VALUES (true);

INSERT INTO {{schema}}.imdb_rating_jobs (user_id, media_type, tt_id, operation, rating, payload)
SELECT states.user_id, media.media_type, ratings.key, 'rate', (ratings.value->>'rating')::smallint, ratings.value
FROM {{schema}}.user_states states
CROSS JOIN LATERAL (VALUES
  ('movie', COALESCE(states.payload#>'{media,movie,ratings}', states.payload->'ratings', '{}'::jsonb)),
  ('tv', COALESCE(states.payload#>'{media,tv,ratings}', '{}'::jsonb))
) media(media_type, records)
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(media.records) = 'object' THEN media.records ELSE '{}'::jsonb END) ratings
WHERE ratings.key ~ '^tt[0-9]+$'
  AND ratings.value->>'status' = 'rated'
  AND ratings.value->>'submitStatus' = 'pending'
  AND ratings.value->>'rating' ~ '^[0-9]+$'
  AND (ratings.value->>'rating')::integer BETWEEN 1 AND 10
ON CONFLICT (user_id, media_type, tt_id) DO NOTHING;
