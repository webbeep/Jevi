-- The app card for a share URL. Opening it does not run a new search.
ALTER TABLE public_answers ADD COLUMN card_json TEXT;
