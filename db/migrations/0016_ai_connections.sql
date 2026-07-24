ALTER TABLE {{schema}}.user_secrets
  ALTER COLUMN secret_type TYPE varchar(80);

ALTER TABLE {{schema}}.user_secrets
  DROP CONSTRAINT IF EXISTS user_secrets_secret_type_check;

ALTER TABLE {{schema}}.user_secrets
  ADD CONSTRAINT user_secrets_secret_type_check
  CHECK (
    secret_type IN ('imdb', 'ai', 'openai')
    OR secret_type ~ '^ai:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

CREATE TABLE IF NOT EXISTS {{schema}}.ai_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  provider_id varchar(32) NOT NULL,
  name varchar(80) NOT NULL,
  base_url text NOT NULL DEFAULT '',
  model_id varchar(512) NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  test_status varchar(24) NOT NULL DEFAULT 'tested',
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_connections_provider_check
    CHECK (provider_id IN ('openai', 'anthropic', 'gemini', 'xai', 'openrouter', 'home', 'custom')),
  CONSTRAINT ai_connections_test_status_check
    CHECK (test_status IN ('tested', 'needs_setup'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_connections_one_default
  ON {{schema}}.ai_connections (user_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS ai_connections_user_updated
  ON {{schema}}.ai_connections (user_id, updated_at DESC);

INSERT INTO {{schema}}.ai_connections (
  user_id, provider_id, name, base_url, model_id, is_default, test_status, last_tested_at
)
SELECT
  preferences.user_id,
  CASE
    WHEN preferences.ai_base_url ILIKE '%openrouter.ai%' THEN 'openrouter'
    WHEN preferences.ai_base_url ILIKE '%api.x.ai%' THEN 'xai'
    WHEN preferences.ai_base_url = '' OR preferences.ai_base_url ILIKE '%api.openai.com%' THEN 'openai'
    ELSE 'custom'
  END,
  CASE
    WHEN preferences.ai_base_url ILIKE '%openrouter.ai%' THEN 'OpenRouter'
    WHEN preferences.ai_base_url ILIKE '%api.x.ai%' THEN 'Grok'
    WHEN preferences.ai_base_url = '' OR preferences.ai_base_url ILIKE '%api.openai.com%' THEN 'ChatGPT / OpenAI'
    ELSE 'Imported AI'
  END,
  CASE
    WHEN preferences.ai_base_url = '' THEN 'https://api.openai.com/v1'
    ELSE preferences.ai_base_url
  END,
  COALESCE(NULLIF(preferences.ai_model, ''), NULLIF(preferences.open_ai_model, ''), ''),
  true,
  CASE
    WHEN COALESCE(NULLIF(preferences.ai_model, ''), NULLIF(preferences.open_ai_model, ''), '') = '' THEN 'needs_setup'
    ELSE 'tested'
  END,
  CASE
    WHEN COALESCE(NULLIF(preferences.ai_model, ''), NULLIF(preferences.open_ai_model, ''), '') = '' THEN NULL
    ELSE now()
  END
FROM {{schema}}.user_preferences AS preferences
WHERE (
  preferences.ai_configured
  OR preferences.ai_model <> ''
  OR preferences.open_ai_model <> ''
  OR EXISTS (
    SELECT 1
    FROM {{schema}}.user_secrets AS secrets
    WHERE secrets.user_id = preferences.user_id
      AND secrets.secret_type IN ('ai', 'openai')
  )
)
AND NOT EXISTS (
  SELECT 1
  FROM {{schema}}.ai_connections AS existing
  WHERE existing.user_id = preferences.user_id
);

REVOKE ALL ON TABLE {{schema}}.ai_connections FROM PUBLIC;
