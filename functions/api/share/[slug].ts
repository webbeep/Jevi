import { shareView } from '../../../shared/publicPage';
import { loadPublicAnswer } from '../../../server/publicAnswer';
import { json, type Env } from '../../../server/util';

/**
 * The stored card for a share URL. This does not call the ask gate: opening or
 * reloading a shared answer is not an ask. A new question still goes through /api/stream.
 */
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const slug = String(params.slug ?? '').toLowerCase();
  const page = await loadPublicAnswer(env, slug).catch(() => undefined);
  if (!page) return json({ error: 'Not found' }, 404, { 'cache-control': 'private, no-store' });
  return json(shareView(page, page.share), 200, { 'cache-control': 'private, no-store' });
};
