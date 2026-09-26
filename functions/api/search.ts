import type { Freshness } from '../../shared/types';
import { search } from '../../server/search';
import { Env, errorJson, json } from '../../server/util';

const FRESHNESS: Freshness[] = ['any', 'day', 'week', 'month', 'year'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim().slice(0, 300);
  if (!q) return errorJson('Missing q', 400);
  const f = url.searchParams.get('freshness') as Freshness;
  const freshness = FRESHNESS.includes(f) ? f : 'any';

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/search?q=${encodeURIComponent(q.toLowerCase())}&freshness=${freshness}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const data = await search({ q, freshness, count: 20 }, env);
    const res = json(data, 200, { 'cache-control': 'public, max-age=600' });
    if (data.results.length) waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return errorJson(err);
  }
};
