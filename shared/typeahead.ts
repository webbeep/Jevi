/**
 * Pure typeahead helpers. No DOM or React — unit-tested from Node.
 */

export interface TypeaheadSuggestion {
  text: string;
  source: 'history' | 'ai' | 'fallback';
}

/** Trim, lowercase, collapse whitespace, clip to 80 characters. */
export function normalizePrefix(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

/**
 * Prefix, substring, or word-start matches. Drops empties, exact input, and
 * queries shorter than 3 characters. Original casing, case-insensitive dedupe.
 */
export function matchLocal(list: string[], input: string): string[] {
  const prefix = normalizePrefix(input);
  if (prefix.length < 3) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = item.trim();
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text || key === prefix || seen.has(key)) continue;
    const words = key.split(' ');
    const hit = key.startsWith(prefix) || key.includes(prefix) || words.some((word) => word.startsWith(prefix));
    if (!hit) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * History, then AI, then local fallback. Case-insensitive dedupe, drop the
 * exact input, cap at `max` (default 5).
 */
export function mergeSuggestions(
  history: string[],
  ai: string[],
  fallback: string[],
  input: string,
  max = 5,
): TypeaheadSuggestion[] {
  const exact = normalizePrefix(input);
  const seen = new Set<string>();
  const out: TypeaheadSuggestion[] = [];
  const take = (list: string[], source: TypeaheadSuggestion['source']) => {
    for (const item of list) {
      if (out.length >= max) return;
      const text = item.trim().replace(/\s+/g, ' ').slice(0, 80).trim();
      const key = text.toLowerCase();
      if (!text || key === exact || seen.has(key)) continue;
      seen.add(key);
      out.push({ text, source });
    }
  };
  take(history, 'history');
  take(ai, 'ai');
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
