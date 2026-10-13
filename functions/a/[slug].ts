import { renderAnswerHtml } from '../../shared/publicPage';
import { loadPublicAnswer } from '../../server/publicAnswer';
import type { Env } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const slug = String(params.slug ?? '').toLowerCase();
  const page = await loadPublicAnswer(env, slug).catch(() => undefined);
  const origin = new URL(request.url).origin;
  if (!page) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Answer not found — ZO</title><meta name="robots" content="noindex"></head><body><p>That answer is not published yet.</p><p><a href="${origin}/">Ask on ZO</a></p></body></html>`, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return new Response(renderAnswerHtml(page, origin), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'index, follow',
    },
  });
};
