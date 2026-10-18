import type { CallLedger } from './budget';
import { normalizeUrl } from './search';
import { type Env, fetchJson } from './util';

/**
 * DeepSeek Search and Fetch. Serper stays the web search and the only image search.
 * Each API is capped at 5 requests/second account-wide, so a turn does at most one
 * search and two fetches, and a full local window fails open instead of queueing.
 * Timeouts and errors return undefined. The caller keeps the Serper snippet.
 */

const QPS = 5;
const WINDOW_MS = 1000;

export interface DeepSeekHit {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  date?: string;
}

export interface FetchedDoc {
  title: string;
  content: string;
}

type Slot = 'search' | 'fetch';

const stamps: Record<Slot, number[]> = { search: [], fetch: [] };

/** Test hook. Production calls do not reset the window. */
export function resetDeepseekSlots(): void {
  stamps.search = [];
  stamps.fetch = [];
}

/** True when this isolate still has room in the one-second window. Does not wait. */
export function takeDeepseekSlot(kind: Slot, now = Date.now()): boolean {
  const bucket = stamps[kind];
  while (bucket.length && now - bucket[0]! >= WINDOW_MS) bucket.shift();
  if (bucket.length >= QPS) return false;
  bucket.push(now);
  return true;
}

function toolsUrl(env: Env, path: Slot): string {
  const raw = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/$/, '');
  const root = raw.replace(/\/v1$/, '');
  return `${root}/v1/tools/${path}`;
}

function note(ledger: CallLedger | undefined, kind: Slot): void {
  if (!ledger) return;
  const cur = ledger.deepseek ?? { search: 0, fetch: 0 };
  cur[kind] += 1;
  ledger.deepseek = cur;
}

async function postTool(env: Env, path: Slot, body: Record<string, unknown>, timeoutMs: number, ledger?: CallLedger): Promise<unknown> {
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key) return undefined;
  if (!takeDeepseekSlot(path)) {
    console.log(JSON.stringify({ zo: 'deepseek', op: path, skipped: 'qps' }));
    return undefined;
  }
  note(ledger, path);
  const started = Date.now();
  try {
    return await fetchJson(toolsUrl(env, path), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
  } catch (err) {
    const failed = err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 80)) : 'error';
    console.log(JSON.stringify({ zo: 'deepseek', op: path, failed, ms: Date.now() - started }));
    return undefined;
  }
}

const caches = new WeakMap<object, Map<string, Promise<FetchedDoc | undefined>>>();

function cacheFor(scope: object): Map<string, Promise<FetchedDoc | undefined>> {
  let map = caches.get(scope);
  if (!map) {
    map = new Map();
    caches.set(scope, map);
  }
  return map;
}

/** One Fetch for this request. A second ask for the same URL reuses the first result, including a miss. */
export function deepseekFetch(env: Env, url: string, scope: object, ledger?: CallLedger, timeoutMs = 1800): Promise<FetchedDoc | undefined> {
  const key = normalizeUrl(url);
  const map = cacheFor(scope);
  const hit = map.get(key);
  if (hit) return hit;
  const pending = loadFetch(env, url, ledger, timeoutMs);
  map.set(key, pending);
  return pending;
}

async function loadFetch(env: Env, url: string, ledger: CallLedger | undefined, timeoutMs: number): Promise<FetchedDoc | undefined> {
  const data = await postTool(env, 'fetch', { url }, timeoutMs, ledger);
  if (!data || typeof data !== 'object') return undefined;
  const row = data as { title?: unknown; content?: unknown };
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  if (!content) return undefined;
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  return { title, content };
}

function hitOf(raw: unknown): DeepSeekHit | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as { title?: unknown; url?: unknown; snippet?: unknown; summary?: unknown; content?: unknown; date?: unknown };
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!url.startsWith('http')) return undefined;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return {
    title: text(row.title),
    url,
    snippet: text(row.snippet),
    summary: text(row.summary),
    content: text(row.content),
    date: text(row.date) || undefined,
  };
}

/**
 * One Search. `needContent` is set only when the caller will not Fetch the page itself.
 * An empty list, a timeout, or an error is a miss: the caller keeps the Serper rows.
 */
export async function deepseekSearch(
  env: Env,
  body: { query: string; count?: number; oriQuestion?: string; needContent?: boolean },
  ledger?: CallLedger,
  timeoutMs = 1800,
): Promise<DeepSeekHit[] | undefined> {
  const query = clipChars(body.query, 128);
  if (!query.trim()) return undefined;
  const ori = body.oriQuestion ? clipChars(body.oriQuestion, 128) : undefined;
  const payload: Record<string, unknown> = {
    query,
    count: Math.min(50, Math.max(1, body.count ?? 5)),
    need_content: body.needContent === true,
  };
  if (ori) payload.ori_question = ori;
  const data = await postTool(env, 'search', payload, timeoutMs, ledger);
  if (!data || typeof data !== 'object') return undefined;
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results) || !results.length) return undefined;
  const hits = results.map(hitOf).filter((hit): hit is DeepSeekHit => !!hit);
  return hits.length ? hits : undefined;
}

export function clipChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('');
}
