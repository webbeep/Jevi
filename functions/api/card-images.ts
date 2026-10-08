import type { CardNode } from '../../shared/card';
import type { SearchResult } from '../../shared/types';
import { findImages } from '../../server/images';
import { ogImageOf } from '../../server/pages';
import { fillRowImages, rowEntity } from '../../server/rowImages';
import { Env, errorJson, json } from '../../server/util';

/**
 * T442 refill for old threads: POST { items: [{ name, source? }] } → { images: (string | null)[] } in the same order.
 * Not an ask: no free-use count, no Serper call (the daily cap stays for real asks). Each item with its own
 * https source page (not shared with another item) gets that page's og:image (~2s, at most 8 pages);
 * name-like items still blank get a free Wikipedia/Commons/Openverse lookup.
 * Responses are edge-cached for a day by request body.
 */
const MAX_ITEMS = 12;
const MAX_OG = 8;

interface Item {
  name?: unknown;
  source?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: { items?: Item[] };
  try {
    body = (await request.json()) as { items?: Item[] };
  } catch {
    return errorJson('Bad JSON', 400);
  }
  if (!Array.isArray(body.items) || !body.items.length) return errorJson('Missing items', 400);
  const items = body.items.slice(0, MAX_ITEMS).map((i) => ({
    name: typeof i.name === 'string' ? rowEntity(i.name).slice(0, 80) : '',
    source: typeof i.source === 'string' && /^https:\/\//i.test(i.source) ? i.source.slice(0, 500) : undefined,
  }));

  const keyText = JSON.stringify(items);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const cacheKey = new Request(`https://card-images.zo.internal/v1/${hex}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Same filler as live cards, minus the Serper call: og:image of each item's own unshared source, then free name lookups.
  const urls = [...new Set(items.flatMap((i) => (i.source ? [i.source] : [])))];
  const results: SearchResult[] = urls.map((url) => ({ title: '', url, snippet: '', domain: '', engines: [] }));
  const node: CardNode = { type: 'list', style: 'media', items: items.map((i) => ({ text: i.name || ' ', source: i.source ? urls.indexOf(i.source) + 1 : undefined })) };
  const filled = await fillRowImages([node], { results, pool: [], og: (url) => ogImageOf(url, 2000), ogMax: MAX_OG, lookup: (name) => findImages(name, env, 3, false) });
  const out = filled.nodes[0] as Extract<CardNode, { type: 'list' }>;
  const unique = out.items.map((i) => i.imageSrc ?? null);
  const res = json({ images: unique }, 200, { 'cache-control': 'public, max-age=86400' });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};
