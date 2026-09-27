import { generateSuggestions } from '../../server/suggest';
import { Env, errorJson, json } from '../../server/util';

/** Suggestions are regenerated every few hours and served from the edge cache in between. */
const BUCKET_HOURS = 3;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const bucket = Math.floor(Date.now() / (BUCKET_HOURS * 3_600_000));
  const cacheKey = new Request(`${new URL(request.url).origin}/api/suggestions?bucket=${bucket}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  try {
    const suggestions = await generateSuggestions(env);
    const res = json({ suggestions }, 200, { 'cache-control': `public, max-age=${BUCKET_HOURS * 3600}` });
    if (suggestions.length) waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return errorJson(err);
  }
};
