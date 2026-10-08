-- Account menu sync opt-in. Default off. history_json is only stored while sync_history is 1.

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  sync_history INTEGER NOT NULL DEFAULT 0,
  history_json TEXT,
  updated_at INTEGER NOT NULL
);
