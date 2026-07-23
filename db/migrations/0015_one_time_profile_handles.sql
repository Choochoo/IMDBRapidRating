ALTER TABLE {{schema}}.user_profiles
  ADD COLUMN handle_chosen boolean NOT NULL DEFAULT false;

UPDATE {{schema}}.user_profiles
SET handle_chosen = handle !~ '^rater-[0-9a-f]{26}$';
