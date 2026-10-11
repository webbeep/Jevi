import { buildHomeIdeas } from '../../server/homeIdeas';
import { errorJson, json, type Env } from '../../server/util';

/** A day's home ideas. The page caches a model set for 24h and a template set for 1h. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  try {
    return json(await buildHomeIdeas(env, body), 200, { 'cache-control': 'private, no-store' });
  } catch (err) {
    return errorJson(err);
  }
};
