/**
 * Legacy LLM suggestion generator. Unused — home starters come from
 * shared/starters.ts (static passing pool). Kept so old imports stay typed.
 */
import { allPassingSuggestions, type Suggestion } from '../shared/starters';
import type { Env } from './util';

export type { Suggestion };

export async function generateSuggestions(_env: Env, _now = new Date()): Promise<Suggestion[]> {
  return allPassingSuggestions();
}
