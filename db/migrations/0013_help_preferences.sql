ALTER TABLE {{schema}}.user_preferences
ADD COLUMN help_preferences jsonb NOT NULL DEFAULT '{
  "enabled": true,
  "reminders": {}
}'::jsonb
CHECK (jsonb_typeof(help_preferences) = 'object');
