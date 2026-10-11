import { loadTrending, trendCountry } from '../../server/trending';
import { json, type Env } from '../../server/util';

/** Daily trending searches. An empty list means the feed was unavailable. */
export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const items = await loadTrending(trendCountry(request));
  return json({ items }, 200, {
    'cache-control': items.length ? 'public, max-age=600' : 'no-store',
  });
};
