import { turnsDegraded } from './degraded';

export const ANSWER_CACHE_VERSION = 'v1';
export const ANSWER_TTL_S = 86400;

const QUOTES = /^["'“”‘’]+|["'“”‘’]+$/;
const TRAILING = /[?!.,;]+$/;

/** NFKC, lowercase, collapsed whitespace, surrounding quotes and trailing punctuation removed. */
export function normalizeAnswerQuery(q: string): string {
  let s = q.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(QUOTES, '').replace(TRAILING, '').trim();
  }
  return s;
}

/** 32-bit FNV-1a, lowercase hex. Sync and allocation-light so cache keys stay cheap. */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function answerCacheUrl(input: { query: string; freshness: string; context?: string }): string {
  const q = encodeURIComponent(normalizeAnswerQuery(input.query));
  // '-e26' (entity4: LangSearch-path labels, famous-name single, pick source gate, never-empty picks, picked-person header; e25 is V7's). '-e24' (t457 SPD5): pictures not found within 1.5 s of the text are left out, so capped cards are kept apart from e23 cards (full picture wait). '-e23' (t457 SPD-C4b): Crossref fallback (OpenAlex 429s the CF edge), so e22 paper cards cached with no scholarly sources must not replay. '-e22' (t457 SPD-C4): paper/DOI asks add OpenAlex works as sources, so cards cached without DOIs must not replay (skips e18 V6, e19/e21 Backend vendor, e20 reverted C2). '-e17' (t457 SPD-C1): long questions naming a capitalised topic are no longer person asks, so fact-check and product cards cached with 0-1 sources must not replay (skips e15 reverted V5 and e16 reserved for entity4). '-e14': t451b purge of a soccer namesake photo cached on the Ray Lee BlueFlame card. '-e13': t451 imageGate relax (single-entity person cards cached with 0 photos; skips '-e11'/'-e12', which hold reverted V3/V4 vendor-price cards). '-e10': entity2 reverted (its e9 person cards must not replay). '-e9': batch C entity2/verdict2 (cached person and yes/no cards from e8 would skip the new choices and labels). '-e8': purge cards whose stored plan carried the router name, and cards from before the verdict gate (skips '-e7', which holds reverted vendor-price cards). '-e6': t444 entity filter fix. '-e5': t444 purge of a profile cached with a namesake's photo. '-e4': T443 purge of cards cached with a metric stat photo ("Points"). '-e3': T442 purge of cards cached before row pictures (and '-e2': T424 edge purge). Every answer cached before this ship (incl. Wikipedia-only cards) is unreachable.
  let url = `https://answer-cache.zo.internal/${ANSWER_CACHE_VERSION}-e26?q=${q}&f=${input.freshness}`;
  if (input.context) url += `&c=${fnv1a(input.context)}`;
  return url;
}

/** Finished, non-degraded answers only. Extractive fallbacks are not locked in for a day. */
export function storableAnswer(frames: { event: string; data: unknown }[]): boolean {
  let done = false;
  let error = false;
  let node = false;
  let extractive = false;
  for (const frame of frames) {
    if (frame.event === 'error') error = true;
    else if (frame.event === 'node') node = true;
    else if (frame.event === 'done') {
      done = true;
      if (frame.data !== null && typeof frame.data === 'object' && (frame.data as { engine?: unknown }).engine === 'extractive') extractive = true;
    }
  }
  return done && !error && node && !extractive;
}

export interface AnswerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function snapshotKey(query: string, freshness = 'any'): string {
  return `zo:answer:${ANSWER_CACHE_VERSION}:${freshness}:${normalizeAnswerQuery(query)}`;
}

export function saveSnapshot(store: AnswerStore, query: string, turns: unknown, now = Date.now()): boolean {
  if (turnsDegraded(turns)) {
    try {
      store.removeItem(snapshotKey(query));
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    store.setItem(snapshotKey(query), JSON.stringify({ v: 1, savedAt: now, turns }));
    return true;
  } catch {
    return false;
  }
}

export function loadSnapshot<T>(store: AnswerStore, query: string, now = Date.now()): T | undefined {
  const key = snapshotKey(query);
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const saved = parsed as { v?: unknown; savedAt?: unknown; turns?: T };
  if (saved.v !== 1 || typeof saved.savedAt !== 'number' || !('turns' in saved)) return undefined;
  if (now - saved.savedAt > ANSWER_TTL_S * 1000) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  if (turnsDegraded(saved.turns)) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  return saved.turns;
}

/** Drop degraded (and unreadable) answer snapshots. Returns how many keys were removed. */
export function purgeDegradedSnapshots(store: AnswerStore & { length: number; key(i: number): string | null }): number {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      let key: string | null = null;
      try {
        key = store.key(i);
      } catch {
        key = null;
      }
      if (key && key.startsWith('zo:answer:')) keys.push(key);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    let raw: string | null;
    try {
      raw = store.getItem(key);
    } catch {
      continue;
    }
    if (raw == null) continue;
    let drop = false;
    try {
      const parsed = JSON.parse(raw) as { turns?: unknown } | null;
      drop = !!parsed && typeof parsed === 'object' && turnsDegraded(parsed.turns) !== null;
    } catch {
      drop = true;
    }
    if (!drop) continue;
    try {
      store.removeItem(key);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}
