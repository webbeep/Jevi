import type { ImageResult } from '../shared/types';
import { decodeEntities } from '../shared/text';
import { type Env, UA, domainOf, fetchJson, fetchText, hedge } from './util';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const TIMEOUT_MS = 3000;
const STOP = new Set(['the', 'and', 'for', 'with', 'photo', 'image', 'picture', 'of', 'in', 'a', 'an', 'shoe', 'shoes']);

/** Significant words of an image query, used to check that a found picture is of that exact item. */
function keywords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

/** A picture counts as specific when its title mentions most of the item's words. */
function matches(query: string, title: string): boolean {
  const words = keywords(query);
  if (!words.length) return true;
  const t = title.toLowerCase();
  const hits = words.filter((w) => t.includes(w)).length;
  return hits >= Math.min(words.length, Math.max(1, Math.ceil(words.length * 0.6)));
}

async function bing(query: string, n: number): Promise<ImageResult[]> {
  const html = await fetchText(
    `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=0&count=${Math.max(n, 6)}&mmasync=1`,
    { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
    TIMEOUT_MS,
  );
  const out: ImageResult[] = [];
  for (const m of html.matchAll(/\sm="(\{[^"]+\})"/g)) {
    try {
      const meta = JSON.parse(decodeEntities(m[1])) as { murl?: string; turl?: string; purl?: string; t?: string };
      if (!meta.turl && !meta.murl) continue;
      out.push({ url: meta.purl ?? meta.murl!, thumb: meta.turl ?? meta.murl!, title: decodeEntities(meta.t ?? ''), source: domainOf(meta.purl ?? meta.murl ?? '') });
    } catch {
      // malformed entry
    }
    if (out.length >= n * 2) break;
  }
  return out;
}

async function exa(query: string, env: Env): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { title?: string; url: string; image?: string }[] }>(
    'https://api.exa.ai/search',
    { method: 'POST', headers: { 'x-api-key': env.EXA_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, numResults: 5, type: 'fast' }) },
    TIMEOUT_MS,
  );
  return (data.results ?? []).filter((r) => r.image).map((r) => ({ url: r.url, thumb: r.image!, title: r.title ?? '', source: domainOf(r.url) }));
}

async function wikipedia(query: string): Promise<ImageResult[]> {
  const search = await fetchJson<{ query?: { search?: { title: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  const title = search.query?.search?.[0]?.title;
  if (!title) return [];
  const page = await fetchJson<{ title: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page?: string } } }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  return page.thumbnail ? [{ url: page.content_urls?.desktop?.page ?? '', thumb: page.thumbnail.source, title: page.title, source: 'wikipedia.org' }] : [];
}

async function brave(query: string, env: Env): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { title: string; url: string; thumbnail?: { src: string } }[] }>(
    `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { 'X-Subscription-Token': env.BRAVE_API_KEY!, Accept: 'application/json' } },
    TIMEOUT_MS,
  );
  return (data.results ?? []).filter((r) => r.thumbnail).map((r) => ({ url: r.url, thumb: r.thumbnail!.src, title: r.title, source: domainOf(r.url) }));
}

async function serper(query: string, env: Env): Promise<ImageResult[]> {
  const data = await fetchJson<{ images?: { title: string; imageUrl: string; thumbnailUrl?: string; link: string }[] }>(
    'https://google.serper.dev/images',
    { method: 'POST', headers: { 'X-API-KEY': env.SERPER_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, num: 5 }) },
    TIMEOUT_MS,
  );
  return (data.images ?? []).map((r) => ({ url: r.link, thumb: r.thumbnailUrl ?? r.imageUrl, title: r.title, source: domainOf(r.link) }));
}

/** Pexels: free stock photos. Generic rather than item-specific, so it is a last resort. */
async function pexels(query: string, env: Env, n: number): Promise<ImageResult[]> {
  const data = await fetchJson<{ photos?: { url: string; alt?: string; src: { medium: string } }[] }>(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${n}`,
    { headers: { Authorization: env.PEXELS_API_KEY! } },
    TIMEOUT_MS,
  );
  return (data.photos ?? []).map((p) => ({ url: p.url, thumb: p.src.medium, title: p.alt ?? query, source: 'pexels.com' }));
}

async function openverse(query: string, n: number): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { url: string; thumbnail?: string; title?: string; foreign_landing_url?: string }[] }>(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${n}&mature=false`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  return (data.results ?? []).map((r) => ({ url: r.foreign_landing_url ?? r.url, thumb: r.thumbnail ?? r.url, title: r.title ?? '', source: domainOf(r.foreign_landing_url ?? r.url) }));
}

const cache = new Map<string, ImageResult[]>();
const CACHE_MAX = 400;

/**
 * Finds up to `n` real pictures of the exact item named by `query`, racing the
 * most specific sources first. Specific sources only count when the picture's
 * title names the item. Stock sources (Pexels, Openverse) are only used with
 * `allowGeneric`, for topic imagery — never to stand in for a specific item.
 */
export async function findImages(query: string, env: Env, n = 1, allowGeneric = false): Promise<ImageResult[]> {
  const key = `${query.toLowerCase()}|${n}|${allowGeneric ? 'g' : 's'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const specific = (task: () => Promise<ImageResult[]>) => async () => {
    const found = (await task()).filter((img) => img.thumb && matches(query, img.title)).slice(0, n);
    if (!found.length) throw new Error('no matching picture');
    return found;
  };
  const generic = (task: () => Promise<ImageResult[]>) => async () => {
    const found = (await task()).filter((img) => img.thumb).slice(0, n);
    if (!found.length) throw new Error('no picture');
    return found;
  };
  const tasks = [
    specific(() => bing(query, n)),
    ...(env.EXA_API_KEY ? [specific(() => exa(query, env))] : []),
    specific(() => wikipedia(query)),
    ...(env.BRAVE_API_KEY ? [specific(() => brave(query, env))] : []),
    ...(env.SERPER_API_KEY ? [specific(() => serper(query, env))] : []),
    ...(allowGeneric && env.PEXELS_API_KEY ? [generic(() => pexels(query, env, n))] : []),
    ...(allowGeneric ? [generic(() => openverse(query, n))] : []),
  ];
  const found = await hedge(tasks, 250).catch(() => [] as ImageResult[]);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, found);
  return found;
}
