-- Free automatic retries. One row per counted ask (identity + IP hash + query hash).
-- n is how many uncounted retries that ask has already consumed. Pruned in the gate, not by cron.

CREATE TABLE IF NOT EXISTS retry_window (
  key TEXT PRIMARY KEY,
  ts INTEGER,
  n INTEGER NOT NULL DEFAULT 0
);
