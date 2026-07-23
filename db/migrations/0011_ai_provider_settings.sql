ALTER TABLE {{schema}}.user_preferences
  ADD COLUMN IF NOT EXISTS ai_base_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_model varchar(512) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_configured boolean NOT NULL DEFAULT false;

UPDATE {{schema}}.user_preferences AS preferences
SET
  ai_base_url = 'https://api.openai.com/v1',
  ai_model = preferences.open_ai_model,
  ai_configured = true
WHERE preferences.open_ai_model <> ''
  AND EXISTS (
    SELECT 1
    FROM {{schema}}.user_secrets AS secrets
    WHERE secrets.user_id = preferences.user_id
      AND secrets.secret_type = 'openai'
  );

ALTER TABLE {{schema}}.user_secrets
  DROP CONSTRAINT IF EXISTS user_secrets_secret_type_check;

ALTER TABLE {{schema}}.user_secrets
  ADD CONSTRAINT user_secrets_secret_type_check
  CHECK (secret_type IN ('imdb', 'openai', 'ai'));
