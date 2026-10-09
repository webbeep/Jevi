/**
 * Pure typeahead helpers. No DOM or React — unit-tested from Node.
 */

export interface TypeaheadSuggestion {
  text: string;
  source: 'history' | 'web' | 'fallback';
}

/** Shortest input that opens the list. */
export const MIN_PREFIX = 2;

/** Trim, lowercase, collapse whitespace, clip to 80 characters. */
export function normalizePrefix(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

/**
 * Prefix matches first, then word-start matches, then (3+ characters) substring matches.
 * Drops empties and the exact input. Original casing, case-insensitive dedupe.
 */
export function matchLocal(list: string[], input: string): string[] {
  const prefix = normalizePrefix(input);
  if (prefix.length < MIN_PREFIX) return [];
  const seen = new Set<string>();
  const tiers: string[][] = [[], [], []];
  for (const item of list) {
    const text = item.trim();
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text || key === prefix || seen.has(key)) continue;
    let tier = -1;
    if (key.startsWith(prefix)) tier = 0;
    else if (key.split(' ').some((word, i, words) => words.slice(i).join(' ').startsWith(prefix))) tier = 1;
    else if (prefix.length >= 3 && key.includes(prefix)) tier = 2;
    if (tier < 0) continue;
    seen.add(key);
    tiers[tier]!.push(text);
  }
  return tiers.flat();
}

/**
 * History (at most `maxHistory`, so web completions still show), then web completions,
 * then local fallback. Case-insensitive dedupe, drop the exact input, cap at `max`.
 */
export function mergeSuggestions(
  history: string[],
  web: string[],
  fallback: string[],
  input: string,
  max = 6,
  maxHistory = 3,
): TypeaheadSuggestion[] {
  const exact = normalizePrefix(input);
  const seen = new Set<string>();
  const out: TypeaheadSuggestion[] = [];
  const take = (list: string[], source: TypeaheadSuggestion['source'], cap = max) => {
    let n = 0;
    for (const item of list) {
      if (out.length >= max || n >= cap) return;
      const text = item.trim().replace(/\s+/g, ' ').slice(0, 80).trim();
      const key = text.toLowerCase();
      if (!text || key === exact || seen.has(key)) continue;
      seen.add(key);
      out.push({ text, source });
      n++;
    }
  };
  take(history, 'history', web.length ? maxHistory : max);
  take(web, 'web');
  take(fallback, 'fallback');
  return out;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/** Timer debouncer. Only the last call runs, and `cancel` drops a pending one. */
export function createDebouncer<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as Debounced<A>;
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}
