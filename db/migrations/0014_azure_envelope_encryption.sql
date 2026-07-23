CREATE TABLE IF NOT EXISTS {{schema}}.user_data_keys (
  user_id uuid PRIMARY KEY REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  wrapped_key text NOT NULL,
  wrapping_key_id text NOT NULL,
  wrapping_algorithm varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE {{schema}}.user_data_keys FROM PUBLIC;
