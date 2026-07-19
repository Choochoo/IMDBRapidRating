CREATE TABLE {{schema}}.rater_queues (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  pool_version varchar(64) NOT NULL,
  seed varchar(128) NOT NULL,
  queue_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(queue_ids) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE {{schema}}.rater_actions (
  user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind IN ('rated', 'notSeen', 'wishlist', 'undo')),
  tt_id varchar(32) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, action_id)
);

CREATE INDEX rater_actions_user_created
  ON {{schema}}.rater_actions (user_id, created_at DESC);
