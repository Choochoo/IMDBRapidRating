CREATE TABLE {{schema}}.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  handle varchar(32) NOT NULL,
  display_name varchar(80) NOT NULL DEFAULT 'Rapid Rater User',
  searchable boolean NOT NULL DEFAULT true,
  share_ratings_with_friends boolean NOT NULL DEFAULT true,
  show_friend_ratings boolean NOT NULL DEFAULT true,
  avatar_version integer NOT NULL DEFAULT 0 CHECK (avatar_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_profiles_handle_unique
  ON {{schema}}.user_profiles (lower(handle));

INSERT INTO {{schema}}.user_profiles (user_id, handle, created_at, updated_at)
SELECT id, 'rater-' || left(replace(id::text, '-', ''), 26), created_at, updated_at
FROM {{schema}}.users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE {{schema}}.user_avatars (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  content_type varchar(32) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_data bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.friendships (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT friendships_distinct_users CHECK (requester_user_id <> recipient_user_id)
);

CREATE UNIQUE INDEX friendships_user_pair_unique
  ON {{schema}}.friendships (LEAST(requester_user_id, recipient_user_id), GREATEST(requester_user_id, recipient_user_id));

CREATE INDEX friendships_requester_status
  ON {{schema}}.friendships (requester_user_id, status);

CREATE INDEX friendships_recipient_status
  ON {{schema}}.friendships (recipient_user_id, status);

CREATE TABLE {{schema}}.recommendation_shares (
  id uuid PRIMARY KEY,
  sender_user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  media_type varchar(16) NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tt_id varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_shares_distinct_users CHECK (sender_user_id <> recipient_user_id),
  CONSTRAINT recommendation_shares_title_id CHECK (tt_id ~ '^tt[0-9]+$'),
  CONSTRAINT recommendation_shares_unique UNIQUE (sender_user_id, recipient_user_id, media_type, tt_id)
);

CREATE INDEX recommendation_shares_recipient_title
  ON {{schema}}.recommendation_shares (recipient_user_id, media_type, tt_id);

CREATE INDEX recommendation_shares_sender_title
  ON {{schema}}.recommendation_shares (sender_user_id, media_type, tt_id);
