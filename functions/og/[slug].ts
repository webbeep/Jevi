import { loadPublicAnswer } from '../../server/publicAnswer';
import { cardPng } from '../../server/ogPng';
import type { Env } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = String(params.slug ?? '');
  const slug = raw.replace(/\.png$/i, '').toLowerCase();
  const page = await loadPublicAnswer(env, slug).catch(() => undefined);
  const png = await cardPng(page?.title ?? 'ZO');
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': page ? 'public, max-age=86400' : 'public, max-age=300',
    },
  });
};
