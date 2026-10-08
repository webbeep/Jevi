import { HttpStatusError } from './util';

/** Hard cap on paid and backup search HTTP calls for one ask, including sub-queries and retries. */
export const SEARCH_CALL_CAP = 3;

const DEAD_MS = 10 * 60 * 1000;

/** Isolate memory: a provider that returned a credit, quota, or auth failure is skipped until this time. */
const deadUntil = new Map<string, number>();

export const SEARCH_ENGINES = ['exa', 'langsearch', 'tavily', 'firecrawl', 'serper', 'wikipedia', 'backup'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

export interface CallLedger {
  search: Record<SearchEngine, number>;
  pages: { jina: number; keyless: number; direct: number };
  cache: 'hit' | 'miss' | 'bypass' | 'off';
  fellThrough: string[];
}

export interface AskScope {
  ledger: CallLedger;
  bypass: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function newLedger(): CallLedger {
  return {
    search: { exa: 0, langsearch: 0, tavily: 0, firecrawl: 0, serper: 0, wikipedia: 0, backup: 0 },
    pages: { jina: 0, keyless: 0, direct: 0 },
    cache: 'off',
    fellThrough: [],
  };
}

export function searchCalls(ledger: CallLedger): number {
  return SEARCH_ENGINES.reduce((n, name) => n + ledger.search[name], 0);
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

/** One line per ask. No keys, headers, query text, or URLs. */
export function logAsk(ledger: CallLedger): void {
  console.log(JSON.stringify({
    zo: 'calls',
    search: ledger.search,
    cache: ledger.cache,
    pages: ledger.pages,
    fellThrough: ledger.fellThrough,
  }));
}
