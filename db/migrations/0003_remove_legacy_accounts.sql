-- Remove username-only accounts and their cascaded account data before making
-- email the sole identity. Sessions are cleared so no removed identity remains
-- authenticated after this migration.
TRUNCATE TABLE {{schema}}.user_sessions;

DELETE FROM {{schema}}.users
  WHERE email IS NULL OR btrim(email) = '';

DROP INDEX IF EXISTS {{schema}}.users_username_unique;

ALTER TABLE {{schema}}.users
  ALTER COLUMN email SET NOT NULL,
  DROP COLUMN IF EXISTS username,
  DROP COLUMN IF EXISTS display_name;
