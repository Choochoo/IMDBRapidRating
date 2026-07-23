DELETE FROM {{schema}}.user_secrets
WHERE secret_type = 'tmdb';

ALTER TABLE {{schema}}.user_secrets
  DROP CONSTRAINT IF EXISTS user_secrets_secret_type_check;

ALTER TABLE {{schema}}.user_secrets
  ADD CONSTRAINT user_secrets_secret_type_check
  CHECK (secret_type IN ('imdb', 'openai'));
