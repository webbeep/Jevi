import { allPassingSuggestions } from '../../shared/starters';
import { json } from '../../server/util';

/**
 * Static passing starter list. No LLM call — the curated pool from
 * shared/starters.ts / starters.pass.json.
 */
export const onRequestGet: PagesFunction = async () => {
  const suggestions = allPassingSuggestions();
  return json(
    { suggestions },
    200,
    { 'cache-control': 'public, max-age=3600' },
  );
};
