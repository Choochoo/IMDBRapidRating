ALTER TABLE {{schema}}.user_preferences
ADD COLUMN streaming_country varchar(2) NOT NULL DEFAULT 'US'
CHECK (streaming_country ~ '^[A-Z]{2}$');
