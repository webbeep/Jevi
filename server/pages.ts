import { cleanMarkdown } from '../shared/text';
import type { SearchResult } from '../shared/types';
import { type LateExtras, normalizeUrl } from './search';
import { type Env, hedge, stripHtml } from './util';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MIN_TEXT = 300;

export interface PageText {
  n: number;
  url: string;
  text: string;
  /** The page's own preview image (og:image), when it was fetched directly. */
  image?: string;
}

function ogImage(html: string, base: string): string | undefined {
  const raw = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i)?.[1];
  if (!raw) return undefined;
  try {
    return new URL(raw.replace(/&amp;/g, '&'), base).toString();
  } catch {
    return undefined;
  }
}


function htmlToText(html: string): string {
  const main = html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return stripHtml(main.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|aside)[\s\S]*?<\/\1>/gi, ' '));
}

async function direct(url: string, signal: AbortSignal, images?: Map<string, string>): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal, redirect: 'follow' });
  if (!res.ok || !res.headers.get('content-type')?.includes('html')) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const image = ogImage(html, url);
  if (image) images?.set(url, image);
  return htmlToText(html);
}

async function jina(url: string, env: Env, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { 'X-Return-Format': 'markdown', 'X-Timeout': '8' };
  if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  return cleanMarkdown(await res.text(), 20000);
}

async function allOrigins(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) throw new Error(`AllOrigins HTTP ${res.status}`);
  return htmlToText(await res.text());
}

/** Fetches one page's readable text, racing direct fetch, Jina reader and AllOrigins. */
export async function pageText(url: string, env: Env, timeoutMs = 9000, maxChars = 6000, images?: Map<string, string>): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  const readable = (task: () => Promise<string>) => async () => {
    const text = await task();
    if (text.length < MIN_TEXT) throw new Error('not enough text');
    return text;
  };
  const text = await hedge([readable(() => direct(url, signal, images)), readable(() => jina(url, env, signal)), readable(() => allOrigins(url, signal))], 500);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Collects page text for the top results within a time budget. Pages that
 * already carry content (e.g. from Tavily) are used first; when fewer than
 * `need` are available, the rest are fetched in parallel and the call returns
 * as soon as `need` pages are in hand or the budget runs out.
 */
export async function collectPages(
  results: SearchResult[],
  env: Env,
  opts: { count: number; need: number; budgetMs: number },
  late?: Promise<LateExtras>,
): Promise<PageText[]> {
  const numbered = results.map((r, i) => ({ r, n: i + 1 }));
  const ready: PageText[] = numbered
    .filter(({ r }) => r.content && r.content.length >= MIN_TEXT)
    .slice(0, opts.count)
    .map(({ r, n }) => ({ n, url: r.url, text: r.content! }));
  if (ready.length >= opts.need) return ready;

  const have = new Set(ready.map((p) => p.n));
  const seen = new Set<string>();
  const missing = numbered.filter(({ r, n }) => !have.has(n) && !seen.has(r.domain) && seen.add(r.domain)).slice(0, opts.count - ready.length + 1);
  const fromLate = async (url: string) => {
    const text = (await late)?.content.get(normalizeUrl(url));
    if (!text || text.length < MIN_TEXT) throw new Error('no late content');
    return text;
  };

  const pages = [...ready];
  const images = new Map<string, string>();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, opts.budgetMs);
    let pending = missing.length;
    if (!pending) resolve();
    for (const { r, n } of missing) {
      Promise.any([fromLate(r.url), pageText(r.url, env, opts.budgetMs + 500, 6000, images)])
        .then((text) => {
          pages.push({ n, url: r.url, text, image: images.get(r.url) });
          if (pages.length >= opts.need) resolve();
        })
        .catch(() => undefined)
        .finally(() => {
          if (--pending === 0) {
            clearTimeout(timer);
            resolve();
          }
        });
    }
  });
  return pages.slice(0, opts.count).sort((a, b) => a.n - b.n);
}
