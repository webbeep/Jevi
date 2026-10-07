-- Signed-in saves. query_hash is SHA-256 of the trimmed query so the same ask
-- returns the existing row. card_json is capped at 64 KB by the API.

CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  card_json TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, query_hash)
);

CREATE INDEX IF NOT EXISTS saved_items_user_created_idx ON saved_items (user_id, created_at);
