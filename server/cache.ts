import type { SearchResponse } from '../shared/types';
import type { Env } from './util';

const TTL_MS = 24 * 60 * 60 * 1000;
const PAYLOAD_MAX = 32_000;

export interface CacheDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export function cacheDb(env: Env): CacheDb | undefined {
  const db = (env as Env & { DB?: CacheDb }).DB;
  if (!db || typeof db.prepare !== 'function') return undefined;
  return db;
}

/** Lowercase, trim, collapse whitespace, then the filters that change the hit list. */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function searchCacheKey(q: string, freshness: string, count: number): string {
  return `${normalizeQuery(q)}|f=${freshness}|n=${count}`;
}

export function packSearch(res: SearchResponse): string {
  const results = res.results.slice(0, 8).map((r) => ({
    title: r.title.slice(0, 180),
    url: r.url.slice(0, 500),
    snippet: r.snippet.slice(0, 320),
    domain: r.domain.slice(0, 120),
    engines: r.engines.slice(0, 4),
    date: r.date?.slice(0, 40),
    content: r.content?.slice(0, 400),
  }));
  const images = res.images.slice(0, 4).map((i) => ({
    url: i.url.slice(0, 500),
    thumb: i.thumb.slice(0, 500),
    title: i.title.slice(0, 120),
    source: i.source.slice(0, 120),
    license: i.license,
    credit: i.credit?.slice(0, 160),
  }));
  const knowledge = res.knowledge
    ? {
        title: res.knowledge.title.slice(0, 180),
        extract: res.knowledge.extract.slice(0, 400),
        url: res.knowledge.url.slice(0, 500),
        description: res.knowledge.description?.slice(0, 160),
      }
    : undefined;
  const body: SearchResponse = {
    query: res.query.slice(0, 300),
    freshness: res.freshness,
    results,
    images,
    knowledge,
    discussions: res.discussions.slice(0, 3).map((d) => ({ ...d, title: d.title.slice(0, 160) })),
    engines: res.engines.slice(0, 6).map((e) => ({ name: e.name, ok: e.ok, count: e.count, ms: e.ms, error: e.error?.slice(0, 40) })),
  };
  let json = JSON.stringify(body);
  if (json.length > PAYLOAD_MAX) {
    body.results = body.results.map((r) => ({ ...r, content: undefined }));
    body.images = body.images.slice(0, 1);
    body.discussions = [];
    json = JSON.stringify(body);
  }
  if (json.length > PAYLOAD_MAX) {
    body.results = body.results.slice(0, 4).map((r) => ({ ...r, snippet: r.snippet.slice(0, 80), content: undefined }));
    body.images = [];
    body.knowledge = undefined;
    json = JSON.stringify(body);
  }
  return json;
}

export function unpackSearch(payload: string): SearchResponse | undefined {
  try {
    const v = JSON.parse(payload) as SearchResponse;
    if (!v || typeof v !== 'object' || !Array.isArray(v.results)) return undefined;
    return v;
  } catch {
    return undefined;
  }
}

export type CacheRead = { kind: 'off' } | { kind: 'miss' } | { kind: 'hit'; response: SearchResponse };

/** `maxAgeMs`: how old a row may be for this query (shared/cacheTtl.ts); at most a day. */
export async function readSearchCache(db: CacheDb | undefined, key: string, now = Date.now(), maxAgeMs = TTL_MS): Promise<CacheRead> {
  if (!db) return { kind: 'off' };
  try {
    const row = await db.prepare('SELECT payload, created_at FROM search_cache WHERE cache_key = ?').bind(key).first<{ payload: string; created_at: number }>();
    if (!row || now - row.created_at > Math.min(maxAgeMs, TTL_MS)) return { kind: 'miss' };
    const response = unpackSearch(row.payload);
    return response ? { kind: 'hit', response } : { kind: 'miss' };
  } catch {
    return { kind: 'off' };
  }
}

export async function writeSearchCache(db: CacheDb, key: string, payload: string, now = Date.now()): Promise<void> {
  if (payload.length > PAYLOAD_MAX) return;
  await db.prepare('INSERT INTO search_cache (cache_key, payload, created_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at').bind(key, payload, now).run();
}
