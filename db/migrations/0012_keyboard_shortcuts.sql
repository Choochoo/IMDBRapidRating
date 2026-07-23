ALTER TABLE {{schema}}.user_preferences
ADD COLUMN keyboard_shortcuts jsonb NOT NULL DEFAULT '{
  "rate-1": "1",
  "rate-2": "2",
  "rate-3": "3",
  "rate-4": "4",
  "rate-5": "5",
  "rate-6": "6",
  "rate-7": "7",
  "rate-8": "8",
  "rate-9": "9",
  "rate-10": "0",
  "skip": "n"
}'::jsonb
CHECK (jsonb_typeof(keyboard_shortcuts) = 'object');
