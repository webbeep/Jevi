import { listPublicAnswers } from '../server/publicAnswer';
import type { Env } from '../server/util';

const PAGES = ['/', '/free-ai-search/', '/google-ai-mode-alternative/', '/privacy.html', '/terms.html'];

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const origin = new URL(request.url).origin;
  const answers = await listPublicAnswers(env).catch(() => []);
  const urls = [
    ...PAGES.map((path) => `${origin}${path}`),
    ...answers.map((row) => `${origin}/a/${row.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((loc) => `  <url><loc>${loc.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
