-- Per-provider daily call counts. day is UTC YYYY-MM-DD. bucket is prod or eval.

CREATE TABLE IF NOT EXISTS provider_usage (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, bucket)
);
