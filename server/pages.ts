import { cleanMarkdown } from '../shared/text';
import type { SearchResult } from '../shared/types';
import type { AskScope } from './budget';
import { engineDead, failureOf, rememberDead } from './budget';
import { loadSkips, tripSkip } from './engineSkip';
import { readPage } from './htmlcap';
import { type LateExtras, normalizeUrl } from './search';
import { HttpStatusError, type Env, stripHtml } from './util';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MIN_TEXT = 300;
/** Jina payment/quota failures skip that reader for ~6h (shared KV ENGINE_SKIP), so asks go straight to direct fetch. */
const JINA_TRIP = new Set(['payment', 'quota', 'credit']);
const JINA_SKIP_MS = 6 * 60 * 60 * 1000;

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
  // A window may start at `<main`/`<article>` with no close tag, or end before `</body>`.
  const opener = /^\s*<(main|article)(?=[\s>/])/i.exec(html);
  let main: string | undefined;
  if (opener && !new RegExp(`</${opener[1]}>`, 'i').test(html)) main = html;
  if (main === undefined) {
    main = html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0];
  }
  if (main === undefined) {
    const bodyAt = /<\/body>/i.test(html) ? -1 : html.search(/<body/i);
    main = bodyAt >= 0 ? html.slice(bodyAt) : html;
  }
  return stripHtml(main.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|aside)[\s\S]*?<\/\1>/gi, ' '));
}

/** Public web pages only: no other schemes or ports, IP literals, or local and internal hostnames. */
export function isFetchable(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || (u.port && u.port !== '80' && u.port !== '443') || u.username) return false;
    const host = u.hostname.toLowerCase();
    return host.includes('.') && !/^[\d.]+$|^\[|(^|\.)(localhost|local|internal|lan|home|arpa)$|pages\.dev$/.test(host);
  } catch {
    return false;
  }
}

async function direct(url: string, signal: AbortSignal, images?: Map<string, string>): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal, redirect: 'follow' });
  if (!res.ok || !res.headers.get('content-type')?.includes('html') || !isFetchable(res.url || url)) throw new Error(`HTTP ${res.status}`);
  const { head, body } = await readPage(res);
  const image = ogImage(head || body.slice(0, 20_000), url);
  if (image) images?.set(url, image);
  return htmlToText(body);
}

async function jinaRead(url: string, signal: AbortSignal, key?: string): Promise<string> {
  const headers: Record<string, string> = { 'X-Return-Format': 'markdown', 'X-Timeout': '8' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal });
  if (!res.ok) {
    let peek = '';
    try {
      peek = (await res.text()).slice(0, 180);
    } catch {
      peek = '';
    }
    throw new HttpStatusError(res.status, peek);
  }
  return cleanMarkdown(await res.text(), 20000);
}

function bump(scope: AskScope | undefined, kind: 'jina' | 'keyless' | 'direct'): void {
  if (scope) scope.ledger.pages[kind] += 1;
}

/**
 * One reader, not a race. Keyed Jina when the key is set and not recently dead.
 * Otherwise keyless r.jina.ai (markdown, less CPU than parsing HTML). Direct fetch
 * only if that fails.
 */
async function readReadable(url: string, env: Env, signal: AbortSignal, images: Map<string, string> | undefined, scope: AskScope | undefined): Promise<string> {
  const enough = (text: string) => {
    if (text.length < MIN_TEXT) throw new Error('not enough text');
    return text;
  };
  const key = env.JINA_API_KEY;
  const skips = await loadSkips(env);
  const skipped = (name: string) => engineDead(name) || (skips[name] ?? 0) > Date.now();
  let straightToDirect = false;
  if (key && !skipped('jina')) {
    bump(scope, 'jina');
    try {
      return enough(await jinaRead(url, signal, key));
    } catch (err) {
      const failure = failureOf(err);
      if (failure.dead) rememberDead('jina');
      // Out of credit: skip Jina everywhere for ~6h and read this page directly.
      if (JINA_TRIP.has(failure.reason)) {
        await tripSkip(env, 'jina', failure.reason, scope?.waitUntil, JINA_SKIP_MS);
        straightToDirect = true;
      }
      if (failure.fall || (err instanceof Error && err.message === 'not enough text')) {
        scope?.ledger.fellThrough.push(`jina:${err instanceof Error && err.message === 'not enough text' ? 'short' : failure.reason}`);
      } else throw err;
    }
  }
  if (!straightToDirect && !skipped('jina-keyless')) {
    bump(scope, 'keyless');
    try {
      return enough(await jinaRead(url, signal));
    } catch (err) {
      const failure = failureOf(err);
      if (failure.dead) rememberDead('jina-keyless');
      if (JINA_TRIP.has(failure.reason)) await tripSkip(env, 'jina-keyless', failure.reason, scope?.waitUntil, JINA_SKIP_MS);
      scope?.ledger.fellThrough.push(`jina-keyless:${err instanceof Error && err.message === 'not enough text' ? 'short' : failure.reason}`);
    }
  }
  bump(scope, 'direct');
  return enough(await direct(url, signal, images));
}

/** Fetches one page's readable text. Keyless Jina when the key is missing or Jina is dead; direct fetch is the fallback. */
export async function pageText(url: string, env: Env, timeoutMs = 9000, maxChars = 6000, images?: Map<string, string>, scope?: AskScope): Promise<string> {
  if (!isFetchable(url)) throw new Error('URL not allowed');
  const signal = AbortSignal.timeout(timeoutMs);
  const text = await readReadable(url, env, signal, images, scope);
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
  scope?: AskScope,
): Promise<PageText[]> {
  const count = Math.min(5, Math.max(0, opts.count));
  const need = Math.min(count, opts.need);
  // Only sources the designer is shown (numbered 1-12) are worth reading.
  const numbered = results.slice(0, 12).map((r, i) => ({ r, n: i + 1 }));
  const ready: PageText[] = numbered
    .filter(({ r }) => r.content && r.content.length >= MIN_TEXT)
    .slice(0, count)
    .map(({ r, n }) => ({ n, url: r.url, text: r.content! }));
  if (ready.length >= need) return ready;

  const have = new Set(ready.map((p) => p.n));
  const seen = new Set<string>();
  const missing = numbered.filter(({ r, n }) => !have.has(n) && !seen.has(r.domain) && seen.add(r.domain)).slice(0, count - ready.length);
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
      Promise.any([fromLate(r.url), pageText(r.url, env, opts.budgetMs + 500, 6000, images, scope)])
        .then((text) => {
          pages.push({ n, url: r.url, text, image: images.get(r.url) });
          if (pages.length >= need) resolve();
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
  return pages.slice(0, count).sort((a, b) => a.n - b.n);
}
