import type { Freshness, SearchResult } from '../shared/types';

const FRESH_DAY = /\b(today|today's|tonight|yesterday|right now|live|breaking|score[sd]?)\b/i;
const FRESH_WEEK = /\b(news|latest|this week|recent(?:ly)?|headlines|updates?)\b/i;

/** Freshness the literal search can take from the ask's own words, before the intent read lands. */
export function guessFreshness(query: string): Freshness {
  if (FRESH_DAY.test(query)) return 'day';
  if (FRESH_WEEK.test(query)) return 'week';
  return 'any';
}

/** The stricter of two freshness windows ('day' beats 'week' beats anything else). */
export function stricter(a: Freshness, b: Freshness): Freshness {
  const rank: Record<Freshness, number> = { day: 4, week: 3, month: 2, year: 1, any: 0 };
  return rank[a] >= rank[b] ? a : b;
}

/** "that's not today's", "this is old news", "not the latest": the last answer wasn't current. */
const STALE = [
  /\b(not|isn'?t|wasn'?t|aren'?t|weren'?t)\s+(?:(?:from|for|the|really|even|actually|very)\s+){0,2}(today|today's|todays|latest|recent|current|up ?to ?date)\b/i,
  /\b(outdated|out of date|stale)\b/i,
  /\bold (news|info|updates?|stuff|results?|articles?|headlines)\b/i,
  /\b(from|was|were|is|are) (yesterday|last week|days ago)\b/i,
];

export const staleComplaint = (text: string) => STALE.some((re) => re.test(text)) && text.trim().split(/\s+/).length <= 14;

const WINDOW_MS: Partial<Record<Freshness, number>> = { day: 36 * 3600_000, week: 8 * 86400_000, month: 32 * 86400_000 };
/** Below this many in-window rows the list stays as it was: thin but current beats empty. */
const MIN_FRESH = 3;

/**
 * For a time-bound ask, dated rows outside the window drop out once enough in-window rows remain;
 * in-window rows lead and undated rows (evergreen pages) follow.
 */
export function preferFresh<T extends Pick<SearchResult, 'date'>>(rows: readonly T[], freshness: Freshness, now = Date.now()): T[] {
  const span = WINDOW_MS[freshness];
  if (!span) return [...rows];
  const at = (r: T) => (r.date ? Date.parse(r.date) : Number.NaN);
  const recent = rows.filter((r) => at(r) >= now - span && at(r) <= now + 86400_000);
  if (recent.length < MIN_FRESH) return [...rows];
  return [...recent, ...rows.filter((r) => Number.isNaN(at(r)))];
}
