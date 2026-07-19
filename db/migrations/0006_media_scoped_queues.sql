ALTER TABLE {{schema}}.recommendation_queue
  ADD COLUMN media_type varchar(16) NOT NULL DEFAULT 'movie'
  CHECK (media_type IN ('movie', 'tv'));

ALTER TABLE {{schema}}.recommendation_queue
  DROP CONSTRAINT recommendation_queue_user_item_unique;

DROP INDEX IF EXISTS {{schema}}.recommendation_queue_user_tt_unique;
DROP INDEX IF EXISTS {{schema}}.recommendation_queue_user_order;

ALTER TABLE {{schema}}.recommendation_queue
  ADD CONSTRAINT recommendation_queue_user_media_item_unique
  UNIQUE (user_id, media_type, item_key);

CREATE UNIQUE INDEX recommendation_queue_user_media_tt_unique
  ON {{schema}}.recommendation_queue (user_id, media_type, tt_id)
  WHERE tt_id <> '';

CREATE INDEX recommendation_queue_user_media_order
  ON {{schema}}.recommendation_queue (user_id, media_type, id);

ALTER TABLE {{schema}}.rater_queues
  ADD COLUMN media_type varchar(16) NOT NULL DEFAULT 'movie'
  CHECK (media_type IN ('movie', 'tv'));

ALTER TABLE {{schema}}.rater_queues
  DROP CONSTRAINT rater_queues_pkey;

ALTER TABLE {{schema}}.rater_queues
  ADD PRIMARY KEY (user_id, media_type);

ALTER TABLE {{schema}}.rater_actions
  ADD COLUMN media_type varchar(16) NOT NULL DEFAULT 'movie'
  CHECK (media_type IN ('movie', 'tv'));

CREATE INDEX rater_actions_user_media_created
  ON {{schema}}.rater_actions (user_id, media_type, created_at DESC);
