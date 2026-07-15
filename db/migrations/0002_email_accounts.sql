ALTER TABLE {{schema}}.users
  ADD COLUMN IF NOT EXISTS email varchar(254);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON {{schema}}.users (lower(email))
  WHERE email IS NOT NULL;
