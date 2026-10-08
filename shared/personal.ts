/**
 * On-device personalization. Storage is injected so this stays unit-testable
 * without localStorage or the DOM.
 */
import {
  PASSING_STARTERS,
  STARTERS,
  pickShown,
  shownCount,
  type StarterKind,
  type Suggestion,
} from './starters.ts';

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Category = 'shopping' | 'compare' | 'howto' | 'decision' | 'plan' | 'other';

export interface HistoryItem {
  q: string;
  t: number;
  cat: Category;
}

export const HISTORY_KEY = 'zo:history';
export const STARTERS_CACHE_KEY = 'zo:starters:v1';
export const ASKCOUNT_KEY = 'zo:askcount';
export const RECENT_KEY = 'zo:recent';
/** Removed by clearHistory when a client persists the typeahead map. */
export const TYPEAHEAD_CACHE_KEY = 'zo:typeahead';

const MAX_HISTORY = 50;
const TTL_MS = 24 * 60 * 60 * 1000;
const ASKS_BEFORE_RECOMPUTE = 5;
const CACHED_GENERICS = 4;
const CATS = new Set<Category>(['shopping', 'compare', 'howto', 'decision', 'plan', 'other']);

interface StarterCache {
  at: number;
  asksAtCompute: number;
  items: Suggestion[];
}

function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* quota */
  }
}

/**
 * Cheap local classifier. More specific phrases win over the broad shopping
 * "buy" token so "should I lease or buy" stays a decision.
 */
export function categorize(q: string): Category {
  const s = q.toLowerCase();
  if (/\bvs\b|\bversus\b|\bcompare\b/.test(s)) return 'compare';
  if (/\bhow to\b|\bsteps\b|\brecipe\b/.test(s)) return 'howto';
  if (/\bshould i\b|\bworth it\b|\blease or\b/.test(s)) return 'decision';
  if (/\bplan\b|\bitinerary\b|\bschedule\b|\bweek\b/.test(s)) return 'plan';
  if (/\bbest\b|\bunder\s*\$|\bcheap\b|\bbuy\b/.test(s)) return 'shopping';
  return 'other';
}

function asCategory(value: unknown, q: string): Category {
  return typeof value === 'string' && CATS.has(value as Category) ? (value as Category) : categorize(q);
}

export function readHistory(storage: Storage): HistoryItem[] {
  try {
    const parsed = JSON.parse(readRaw(storage, HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HistoryItem[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const q = (row as { q?: unknown }).q;
      const t = (row as { t?: unknown }).t;
      if (typeof q !== 'string' || !q.trim() || typeof t !== 'number') continue;
      out.push({ q: q.trim(), t, cat: asCategory((row as { cat?: unknown }).cat, q) });
      if (out.length >= MAX_HISTORY) break;
    }
    return out;
  } catch {
    return [];
  }
}

function askCount(storage: Storage, historyLen: number): number {
  const raw = readRaw(storage, ASKCOUNT_KEY);
  if (raw == null) return historyLen;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : historyLen;
}

/** Newest first, max 50, deduped case-insensitively. Also bumps zo:askcount. */
export function recordAsk(storage: Storage, q: string, now = Date.now()): HistoryItem[] {
  const query = q.trim();
  if (!query) return readHistory(storage);
  const prev = readHistory(storage).filter((h) => h.q.toLowerCase() !== query.toLowerCase());
  const next = [{ q: query, t: now, cat: categorize(query) }, ...prev].slice(0, MAX_HISTORY);
  writeRaw(storage, HISTORY_KEY, JSON.stringify(next));
  writeRaw(storage, ASKCOUNT_KEY, String(askCount(storage, prev.length) + 1));
  return next;
}

function kindCategory(kind: StarterKind): Category {
  switch (kind) {
    case 'ranked': return 'shopping';
    case 'compare': return 'compare';
    case 'steps': return 'howto';
    case 'decision': return 'decision';
    case 'plan': return 'plan';
    default: return 'other';
  }
}

function clip70(text: string): string {
  return text.length > 70 ? text.slice(0, 70).trimEnd() : text;
}

/** One follow-on templated from the newest ask. */
export function followOn(last: HistoryItem): Suggestion {
  const ask = last.q.trim();
  let text: string;
  switch (last.cat) {
    case 'shopping': text = `compare top picks for ${ask}`; break;
    case 'howto': text = `${ask} — common mistakes`; break;
    case 'decision': text = `pros and cons: ${ask}`; break;
    case 'compare': text = `which is better value: ${ask}`; break;
    case 'plan': text = `${ask}: checklist`; break;
    default: text = `more on ${ask}`; break;
  }
  return { id: 'p-last', text: clip70(text), icon: 'history', group: 'broad' };
}

function rankedGenerics(history: HistoryItem[]): Suggestion[] {
  const freq = new Map<Category, number>();
  for (const h of history) freq.set(h.cat, (freq.get(h.cat) ?? 0) + 1);
  const pool = [
    ...PASSING_STARTERS,
    ...STARTERS.filter((s) => s.id.startsWith('v2b-')),
  ];
  const ranked = pool
    .map((s, i) => ({ s, i, f: freq.get(kindCategory(s.kind)) ?? 0 }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { s } of ranked) {
    const key = s.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: s.id, text: s.text, icon: s.icon, group: s.group });
    if (out.length >= CACHED_GENERICS) break;
  }
  return out;
}

function readCache(storage: Storage): StarterCache | null {
  try {
    const raw = readRaw(storage, STARTERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StarterCache;
    if (!parsed || typeof parsed.at !== 'number' || typeof parsed.asksAtCompute !== 'number' || !Array.isArray(parsed.items)) return null;
    if (!parsed.items.every((it) => !!it && typeof it.id === 'string' && typeof it.text === 'string' && typeof it.icon === 'string' && (it.group === 's1' || it.group === 'broad'))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function computeItems(history: HistoryItem[]): Suggestion[] {
  const last = history[0];
  if (!last) return [];
  const follow = followOn(last);
  const generics = rankedGenerics(history).filter((s) => s.text.toLowerCase() !== follow.text.toLowerCase());
  return [follow, ...generics];
}

/**
 * Cold start (no history) returns the generic Strategy set and does not cache.
 * Otherwise the cached ranking is reused until it is 24h old or 5 new asks land.
 * The returned list is sliced for the viewport; the cache keeps the longer list.
 */
export function personalizedStarters(storage: Storage, width: number, now = Date.now()): { items: Suggestion[]; personalized: boolean } {
  const history = readHistory(storage);
  if (!history.length) return { items: pickShown(width), personalized: false };

  const asks = askCount(storage, history.length);
  const cached = readCache(storage);
  const fresh = cached && now - cached.at < TTL_MS && asks - cached.asksAtCompute < ASKS_BEFORE_RECOMPUTE;
  const items = fresh && cached ? cached.items : computeItems(history);
  if (!fresh) {
    const payload: StarterCache = { at: now, asksAtCompute: asks, items };
    writeRaw(storage, STARTERS_CACHE_KEY, JSON.stringify(payload));
  }
  return { items: items.slice(0, shownCount(width)), personalized: true };
}

export function clearHistory(storage: Storage): void {
  for (const key of [HISTORY_KEY, STARTERS_CACHE_KEY, ASKCOUNT_KEY, RECENT_KEY, TYPEAHEAD_CACHE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
