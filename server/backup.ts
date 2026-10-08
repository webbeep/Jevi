import { stripHtml } from '../shared/text';
import type { Freshness } from '../shared/types';
import { HttpStatusError } from './util';

/** Bytes of HTML the backup parser will scan. Keeps the regex off the rest of the page. */
export const BACKUP_HTML_CAP = 32_768;

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export interface BackupHit {
  title: string;
  url: string;
  snippet: string;
}

function unwrapDdg(href: string): string | undefined {
  let url = href.replace(/&amp;/g, '&');
  if (url.startsWith('//')) url = `https:${url}`;
  try {
    if (url.includes('uddg=')) {
      const target = new URL(url).searchParams.get('uddg');
      if (!target) return undefined;
      url = target;
    }
  } catch {
    return undefined;
  }
  if (!/^https?:\/\//.test(url) || /duckduckgo\.com/i.test(url)) return undefined;
  return url;
}

/**
 * DuckDuckGo lite results. One pass over a capped slice: anchor, then a short
 * window for the snippet. No DOM and no scan of the rest of the document.
 */
export function parseDdgLite(html: string): BackupHit[] {
  const src = html.length > BACKUP_HTML_CAP ? html.slice(0, BACKUP_HTML_CAP) : html;
  const hits: BackupHit[] = [];
  const anchor = /<a\b[^>]{0,500}\bclass=['"]result-link['"][^>]{0,200}>([\s\S]{0,300}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(src)) && hits.length < 8) {
    const href = /href=["']([^"']+)["']/.exec(match[0])?.[1];
    const url = href && unwrapDdg(href);
    const title = stripHtml(match[1] ?? '');
    if (!url || !title) continue;
    const after = src.slice(match.index + match[0].length, match.index + match[0].length + 700);
    const snippet = stripHtml(/class=['"]result-snippet['"][^>]{0,120}>([\s\S]{0,500}?)<\/td>/i.exec(after)?.[1] ?? '');
    hits.push({ title, url, snippet });
  }
  return hits;
}

async function readCap(res: Response, cap: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, cap);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  try {
    while (out.length < cap) {
      const { done, value } = await reader.read();
      if (done) {
        out += dec.decode();
        break;
      }
      out += dec.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.length > cap ? out.slice(0, cap) : out;
}

const FRESH: Record<Exclude<Freshness, 'any'>, string> = { day: 'd', week: 'w', month: 'm', year: 'y' };

/** One request to DuckDuckGo lite. Callers count it against the search cap. */
export async function fetchBackup(q: string, freshness: Freshness): Promise<BackupHit[]> {
  const df = freshness === 'any' ? '' : `&df=${FRESH[freshness]}`;
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}${df}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(6500),
  });
  if (!res.ok) {
    let peek = '';
    try {
      peek = (await res.text()).slice(0, 180);
    } catch {
      peek = '';
    }
    throw new HttpStatusError(res.status, peek);
  }
  return parseDdgLite(await readCap(res, BACKUP_HTML_CAP));
}
