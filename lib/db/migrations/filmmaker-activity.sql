-- Additive migration only: never alter/delete existing account or pitch data.
CREATE TABLE IF NOT EXISTS filmmaker_activity (
  identity_key text PRIMARY KEY,
  visitor_id text REFERENCES visitors(visitor_id) ON DELETE CASCADE,
  first_activity_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filmmaker_activity_identity_check CHECK (
    (visitor_id IS NOT NULL AND identity_key = 'visitor:' || visitor_id)
    OR (visitor_id IS NULL AND identity_key ~ '^(firebase|replit):.+$')
  )
);