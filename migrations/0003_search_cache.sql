-- 24h cache of trimmed search results. Safe to apply when patch G's 0001/0002 are already on zo2-db.
CREATE TABLE IF NOT EXISTS search_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS search_cache_created_idx ON search_cache (created_at);
