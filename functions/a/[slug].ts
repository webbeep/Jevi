import { shareDocument } from '../../shared/crawler';
import { isFollowupSlug, renderAnswerHtml } from '../../shared/publicPage';
import { loadPublicAnswer } from '../../server/publicAnswer';
import type { Env } from '../../server/util';

type AssetEnv = Env & { ASSETS?: { fetch: (input: Request) => Promise<Response> } };

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>zo</title><meta name="robots" content="noindex"></head><body><p>That answer is not published yet.</p></body></html>`;

/** The app shell, at the share URL. A cached plain page must not be reused for a browser. */
async function appShell(request: Request, env: AssetEnv): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = '/index.html';
  url.search = '';
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  const asset = env.ASSETS
    ? await env.ASSETS.fetch(new Request(url, { method: 'GET', headers }))
    : new Response('<!doctype html><html><head><title>zo</title></head><body><div id="root"></div></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const out = new Headers(asset.headers);
  out.set('content-type', asset.headers.get('content-type') || 'text/html; charset=utf-8');
  out.set('cache-control', 'private, no-store');
  out.set('cdn-cache-control', 'no-store');
  return new Response(asset.body, { status: asset.status, headers: out });
}

export const onRequestGet: PagesFunction<AssetEnv> = async ({ params, env, request }) => {
  if (shareDocument(request.headers.get('user-agent')) === 'app') return appShell(request, env);
  const slug = String(params.slug ?? '').toLowerCase();
  const page = await loadPublicAnswer(env, slug).catch(() => undefined);
  const origin = new URL(request.url).origin;
  if (!page) {
    return new Response(NOT_FOUND, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(renderAnswerHtml(page, origin), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      // A shared follow-up only makes sense after the conversation before it: open to anyone, not indexed.
      'x-robots-tag': isFollowupSlug(slug) ? 'noindex, follow' : 'index, follow',
    },
  });
};
