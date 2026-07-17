CREATE TABLE {{schema}}.recommendation_queue (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  tt_id varchar(32) NOT NULL DEFAULT '',
  title text NOT NULL,
  release_year integer,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_queue_user_item_unique UNIQUE (user_id, item_key)
);

CREATE UNIQUE INDEX recommendation_queue_user_tt_unique
  ON {{schema}}.recommendation_queue (user_id, tt_id)
  WHERE tt_id <> '';

CREATE INDEX recommendation_queue_user_order
  ON {{schema}}.recommendation_queue (user_id, id);
