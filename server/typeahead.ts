/**
 * Prefix completions for the home input, from the public search-suggest endpoints
 * (Google, DuckDuckGo as a hedge). No model call and no key: ~100-300 ms and free.
 * Isolate LRU + Cache API in front. Failures return an empty list so the client
 * falls back to history and starters.
 */
import { normalizePrefix } from '../shared/typeahead.ts';
import { UA, type Env } from './util';

export { normalizePrefix };

const PROVIDER_TIMEOUT_MS = 900;
const HEDGE_MS = 150;
const MEM_MAX = 500;
const MAX_SUGGESTIONS = 6;

export interface TypeaheadResponse {
  suggestions: string[];
  source: 'web' | 'cache' | 'none';
  ms: number;
  /** Why nothing came back (off, timeout, provider error). Provider error text only. */
  reason?: string;
}

type Fetch = typeof fetch;

const mem = new Map<string, string[]>();

/** Clears the isolate cache (unit tests). */
export function resetTypeaheadCache(): void {
  mem.clear();
}

function memGet(key: string): string[] | undefined {
  const hit = mem.get(key);
  if (!hit) return;
  mem.delete(key);
  mem.set(key, hit);
  return hit;
}

function memSet(key: string, value: string[]) {
  if (!value.length) return;
  if (mem.has(key)) mem.delete(key);
  mem.set(key, value);
  while (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

function cacheKey(prefix: string): string {
  return `https://typeahead.cache/v2?q=${encodeURIComponent(prefix)}`;
}

function none(t0: number, reason?: string): TypeaheadResponse {
  return { suggestions: [], source: 'none', ms: Date.now() - t0, ...(reason ? { reason: reason.slice(0, 160) } : {}) };
}

/**
 * The OpenSearch suggestion shape both providers answer with: `[query, [s1, s2, ...], ...]`.
 * Cleaned, deduped case-insensitively, the exact prefix dropped. Exported for unit tests.
 */
export function parseSuggest(data: unknown, prefix: string): string[] {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  const p = normalizePrefix(prefix);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of data[1] as unknown[]) {
    const item = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { phrase?: unknown }).phrase === 'string' ? (raw as { phrase: string }).phrase : '';
    const text = item.replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (!text || text.length > 80 || key === p || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

async function fetchSuggest(url: string, prefix: string, doFetch: Fetch): Promise<string[]> {
  const res = await doFetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseSuggest(JSON.parse(await res.text()), prefix);
  if (!list.length) throw new Error('empty');
  return list;
}

const PROVIDERS: ((q: string) => string)[] = [
  (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`,
  (q) => `https://duckduckgo.com/ac/?type=list&kl=us-en&q=${encodeURIComponent(q)}`,
];

/** Google first; DuckDuckGo joins after HEDGE_MS or as soon as Google fails. First non-empty list wins. */
function hedged(prefix: string, doFetch: Fetch): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const errors: string[] = [];
    let started = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const launch = () => {
      if (done || started >= PROVIDERS.length) return;
      const url = PROVIDERS[started++]!(prefix);
      if (started < PROVIDERS.length) timer = setTimeout(launch, HEDGE_MS);
      fetchSuggest(url, prefix, doFetch).then(
        (list) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(list);
        },
        (err: unknown) => {
          errors.push(err instanceof Error ? err.message : String(err));
          if (errors.length === PROVIDERS.length) {
            done = true;
            reject(new Error(errors.join('; ')));
          } else {
            clearTimeout(timer);
            launch();
          }
        },
      );
    };
    launch();
  });
}

async function readEdgeCache(prefix: string): Promise<string[] | undefined> {
  if (typeof caches === 'undefined') return;
  try {
    const hit = await caches.default.match(new Request(cacheKey(prefix)));
    if (!hit) return;
    const data = (await hit.json()) as { suggestions?: unknown };
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, MAX_SUGGESTIONS) : [];
    return suggestions.length ? suggestions : undefined;
  } catch {
    return;
  }
}

async function writeEdgeCache(prefix: string, suggestions: string[]) {
  if (typeof caches === 'undefined' || !suggestions.length) return;
  try {
    await caches.default.put(
      new Request(cacheKey(prefix)),
      new Response(JSON.stringify({ suggestions }), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      }),
    );
  } catch {
    /* cache is best-effort */
  }
}

export async function suggestTypeahead(q: string, env: Env, doFetch: Fetch = fetch): Promise<TypeaheadResponse> {
  const t0 = Date.now();
  const prefix = normalizePrefix(q);
  if (prefix.length < 2) return none(t0);
  if (env.TYPEAHEAD === 'off') return none(t0, 'off');

  const remembered = memGet(prefix);
  if (remembered) return { suggestions: remembered, source: 'cache', ms: Date.now() - t0 };

  const edge = await readEdgeCache(prefix);
  if (edge) {
    memSet(prefix, edge);
    return { suggestions: edge, source: 'cache', ms: Date.now() - t0 };
  }

  try {
    const suggestions = await hedged(prefix, doFetch);
    memSet(prefix, suggestions);
    await writeEdgeCache(prefix, suggestions);
    return { suggestions, source: 'web', ms: Date.now() - t0 };
  } catch (e) {
    return none(t0, e instanceof Error ? e.message : String(e));
  }
}
