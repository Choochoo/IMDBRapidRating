CREATE TABLE IF NOT EXISTS {{schema}}.users (
  id uuid PRIMARY KEY,
  username varchar(160) NOT NULL,
  display_name varchar(160) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON {{schema}}.users (lower(username));

CREATE TABLE IF NOT EXISTS {{schema}}.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  open_ai_model varchar(160) NOT NULL DEFAULT '',
  open_ai_model_lag integer NOT NULL DEFAULT 2 CHECK (open_ai_model_lag BETWEEN 0 AND 20),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.user_states (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ratings_csv text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS {{schema}}.user_secrets (
  user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  secret_type varchar(32) NOT NULL CHECK (secret_type IN ('imdb', 'tmdb', 'openai')),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, secret_type)
);

CREATE TABLE IF NOT EXISTS {{schema}}.user_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON {{schema}}.user_sessions (expire);
