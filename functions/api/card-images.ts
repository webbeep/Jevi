import { ogImageOf } from '../../server/pages';
import { rowEntity } from '../../server/rowImages';
import { Env, errorJson, json } from '../../server/util';

/**
 * T442 refill for old threads: POST { items: [{ name, source? }] } → { images: (string | null)[] } in the same order.
 * Not an ask: no free-use count, no Serper call (the daily cap stays for real asks). Each item with its own
 * https source page (not shared with another item) gets that page's og:image, ~2s per page, at most 8 pages.
 * Responses are edge-cached for a day by request body.
 */
const MAX_ITEMS = 12;
const MAX_OG = 8;

interface Item {
  name?: unknown;
  source?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, waitUntil }) => {
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

  const perSource = new Map<string, number>();
  for (const i of items) if (i.source) perSource.set(i.source, (perSource.get(i.source) ?? 0) + 1);
  let budget = MAX_OG;
  const used = new Set<string>();
  const images = await Promise.all(
    items.map(async (i) => {
      if (!i.source || perSource.get(i.source) !== 1 || budget-- <= 0) return null;
      return (await ogImageOf(i.source, 2000)) ?? null;
    }),
  );
  const unique = images.map((src) => (src && !used.has(src) && used.add(src) ? src : null));
  const res = json({ images: unique }, 200, { 'cache-control': 'public, max-age=86400' });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};
