-- T446: every signed-in ask (search or follow-up), newest first in the profile panel.
-- card_json is the finished card the client reports back (capped at 64 KB), so a tap reopens it.
CREATE TABLE IF NOT EXISTS ask_history (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  card_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ask_history_user_created_idx ON ask_history (user_id, created_at, id);
CREATE INDEX IF NOT EXISTS ask_history_user_hash_idx ON ask_history (user_id, query_hash, created_at);
