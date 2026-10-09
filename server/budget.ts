import { estimateCost } from './router';
import { clearSkipCache } from './engineSkip';
import { HttpStatusError } from './util';

/** Hard cap on paid and backup search HTTP calls for one ask, including sub-queries and retries. */
export const SEARCH_CALL_CAP = 3;

const DEAD_MS = 10 * 60 * 1000;

/** Isolate memory: a provider that returned a credit, quota, or auth failure is skipped until this time. */
const deadUntil = new Map<string, number>();

export const SEARCH_ENGINES = ['exa', 'langsearch', 'tavily', 'firecrawl', 'serper', 'you', 'you-keyless', 'wikipedia', 'backup'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

export interface CallLedger {
  search: Record<SearchEngine, number>;
  pages: { jina: number; keyless: number; direct: number };
  cache: 'hit' | 'miss' | 'bypass' | 'off';
  fellThrough: string[];
  /** Extra calls allowed after an empty result, for relaxed and entity retries. Unset on the normal path. */
  bonus?: number;
  /** Why the first search was empty, when recovery ran. */
  empty?: string;
  /** Intent route for this ask (server log only). */
  route?: 'quick' | 'deep';
  /** QA fault injection (valid test token only): skip Serper, or every keyed engine. */
  force?: 'serper-off' | 'degraded';
  /** Extra Serper /images calls for this card (0 or 1). */
  imageCalls?: number;
  /** T442: tiles/rows that got a picture after design, and og:image fetches spent. */
  rowPics?: { filled: number; og: number };
  /** Model that wrote the card (server log only). */
  via?: string;
  /** Hits removed by the relevance gate before the answer model saw them. */
  relevanceDropped?: number;
  /** SPD-P: share of the Serper prod day this ask may draw on (signed-out asks < 1). */
  serperShare?: number;
  /** T444 entity disambiguation outcome for this ask (server log only). */
  entity?: { kind: string; id?: string; dropped?: number; choices?: number };
}

export interface AskScope {
  ledger: CallLedger;
  bypass: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Valid `x-zo-test-token` only. Selects the eval daily-cap bucket. */
  eval?: boolean;
  /** Engine that answered, when a search ran. */
  served?: string;
}

export function newLedger(): CallLedger {
  return {
    search: { exa: 0, langsearch: 0, tavily: 0, firecrawl: 0, serper: 0, you: 0, 'you-keyless': 0, wikipedia: 0, backup: 0 },
    pages: { jina: 0, keyless: 0, direct: 0 },
    cache: 'off',
    fellThrough: [],
  };
}

export function searchCalls(ledger: CallLedger): number {
  return SEARCH_ENGINES.reduce((n, name) => n + ledger.search[name], 0);
}

/** Normal asks stay at SEARCH_CALL_CAP. Empty recovery may add `ledger.bonus`. */
export function callCap(ledger: CallLedger): number {
  return SEARCH_CALL_CAP + (ledger.bonus ?? 0);
}

export function rememberDead(engine: string, now = Date.now()): void {
  deadUntil.set(engine, now + DEAD_MS);
}

export function engineDead(engine: string, now = Date.now()): boolean {
  const until = deadUntil.get(engine);
  if (!until) return false;
  if (until <= now) {
    deadUntil.delete(engine);
    return false;
  }
  return true;
}

export function clearDeadEngines(): void {
  deadUntil.clear();
  clearSkipCache();
}

const CREDIT = /credit|trial|expired|billing|payment|insufficient|quota|exceed/;

export function isTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Whether this failure should try the next search engine, and whether the engine
 * should be skipped for a few minutes. The peek is only used for classification.
 */
export function failureOf(err: unknown): { fall: boolean; dead: boolean; reason: string } {
  if (isTimeout(err)) return { fall: true, dead: false, reason: 'timeout' };
  if (err instanceof HttpStatusError) {
    const credit = CREDIT.test(err.peek.toLowerCase());
    const status = err.status;
    if (status === 402 || status === 429 || status === 432 || status === 401 || status === 403 || status >= 500) {
      const reason = status === 402 ? 'payment' : status === 429 ? (credit ? 'quota' : 'rate') : status === 432 ? 'unavailable' : status === 401 || status === 403 ? (credit ? 'credit' : 'auth') : 'upstream';
      const dead = status === 402 || status === 429 || status === 432 || status === 401 || status === 403;
      return { fall: true, dead, reason };
    }
    if (status >= 400 && status < 500 && credit) return { fall: true, dead: true, reason: 'quota' };
    return { fall: false, dead: false, reason: `http${status}` };
  }
  if (err instanceof TypeError) return { fall: true, dead: false, reason: 'network' };
  return { fall: true, dead: false, reason: 'error' };
}

const cleanQuery = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 180);

/**
 * The person's question, unchanged. It is always one of the searches: a planner
 * rewrite is an extra call, not a replacement.
 */
export function queriesForAsk(literal: string, _extras: string[]): string {
  return cleanQuery(literal);
}

/**
 * Planner rewrites that say something the literal question does not.
 * At most two: with the literal search that is the whole three-call cap,
 * so Wikipedia runs only when fewer than two rewrites are left.
 */
export function moreQueries(literal: string, extras: string[]): string[] {
  const base = cleanQuery(literal).toLowerCase();
  const out: string[] = [];
  for (const raw of extras) {
    const q = cleanQuery(raw);
    if (!q || q.toLowerCase() === base || out.some((x) => x.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length === 2) break;
  }
  return out;
}

/** One line per ask. No keys, headers, query text, or URLs. `served` is the engine name only. */
export function logAsk(ledger: CallLedger, served?: string): void {
  console.log(JSON.stringify({
    zo: 'calls',
    search: ledger.search,
    cache: ledger.cache,
    pages: ledger.pages,
    fellThrough: ledger.fellThrough,
    ...(served ? { served } : {}),
    ...(ledger.route ? { route: ledger.route } : {}),
    ...(ledger.force ? { force: ledger.force } : {}),
    ...(ledger.imageCalls ? { imageCalls: ledger.imageCalls } : {}),
    ...(ledger.rowPics ? { rowPics: ledger.rowPics } : {}),
    ...(ledger.via ? { via: ledger.via } : {}),
    ...estimateCost(ledger),
    ...(ledger.empty ? { empty: ledger.empty } : {}),
    ...(ledger.relevanceDropped != null ? { relevanceDropped: ledger.relevanceDropped } : {}),
    ...(ledger.entity ? { entity: ledger.entity } : {}),
  }));
}
