-- One public HTML page per finished answer. The slug is the share URL.
CREATE TABLE IF NOT EXISTS public_answers (
  slug TEXT PRIMARY KEY NOT NULL,
  query TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
