import { parseTrendsRss, TRENDING_POOL, type TrendQuery } from '../shared/trending.ts';
import { UA } from './util.ts';

const TTL_MS = 10 * 60 * 1000;
const FETCH_MS = 4000;

type Fetch = typeof fetch;

const mem = new Map<string, { at: number; items: TrendQuery[] }>();

/** Clears the isolate cache (unit tests). */
export function resetTrendingCache(): void {
  mem.clear();
}

/** ISO country from Cloudflare, otherwise the US feed. */
export function trendCountry(request: Request): string {
  const cf = (request as Request & { cf?: { country?: string } }).cf?.country;
  const raw = (cf || request.headers.get('cf-ipcountry') || 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw) || raw === 'XX' || raw === 'T1') return 'US';
  return raw;
}

function cacheKey(geo: string): string {
  return `https://trending.cache/v1?geo=${encodeURIComponent(geo)}`;
}

async function readEdge(geo: string): Promise<TrendQuery[] | undefined> {
  if (typeof caches === 'undefined') return;
  try {
    const hit = await caches.default.match(new Request(cacheKey(geo)));
    if (!hit) return;
    const data = (await hit.json()) as { items?: unknown };
    const items = asTrends(data.items);
    return items.length ? items : undefined;
  } catch {
    return;
  }
}

async function writeEdge(geo: string, items: TrendQuery[]): Promise<void> {
  if (typeof caches === 'undefined' || !items.length) return;
  try {
    await caches.default.put(
      new Request(cacheKey(geo)),
      new Response(JSON.stringify({ items }), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600' },
      }),
    );
  } catch {
    /* cache is best-effort */
  }
}

function asTrends(value: unknown): TrendQuery[] {
  if (!Array.isArray(value)) return [];
  const items: TrendQuery[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const query = (row as { query?: unknown }).query;
    if (typeof query !== 'string' || !query.trim()) continue;
    items.push({ query: query.trim() });
  }
  return items;
}

async function fetchFeed(geo: string, doFetch: Fetch): Promise<TrendQuery[]> {
  const hit = mem.get(geo);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const edge = await readEdge(geo);
  if (edge) {
    mem.set(geo, { at: Date.now(), items: edge });
    return edge;
  }
  const res = await doFetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) throw new Error(`trends ${res.status}`);
  const items = parseTrendsRss(await res.text(), TRENDING_POOL);
  if (items.length) {
    mem.set(geo, { at: Date.now(), items });
    await writeEdge(geo, items);
  }
  return items;
}

/**
 * Daily trending searches for one country. An empty local feed falls back to the US list.
 * A failed fetch returns whatever is still cached, or nothing.
 */
export async function loadTrending(geo: string, doFetch: Fetch = fetch): Promise<TrendQuery[]> {
  const code = /^[A-Z]{2}$/.test(geo) ? geo : 'US';
  try {
    const local = await fetchFeed(code, doFetch);
    if (local.length || code === 'US') return local;
  } catch {
    const stale = mem.get(code);
    if (stale?.items.length) return stale.items;
    if (code === 'US') return [];
  }
  try {
    return await fetchFeed('US', doFetch);
  } catch {
    return mem.get('US')?.items ?? [];
  }
}
