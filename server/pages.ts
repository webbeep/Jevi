import type { SearchResult } from '../shared/types';
import { clip, stripHtml } from './util';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export interface PageText {
  n: number;
  url: string;
  text: string;
}

async function pageText(url: string, ms: number): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!res.ok || !res.headers.get('content-type')?.includes('html')) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const main = html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return stripHtml(main.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' '));
}

/** Reads the top results (one per domain) in parallel, keeping whatever loads in time. */
export async function readTopPages(results: SearchResult[], count = 3, ms = 4500, maxChars = 3500): Promise<PageText[]> {
  const seen = new Set<string>();
  const picks = results
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => !r.domain.includes('wikipedia.org') && !seen.has(r.domain) && seen.add(r.domain))
    .slice(0, count + 1);
  const settled = await Promise.allSettled(picks.map(async ({ r, n }) => ({ n, url: r.url, text: clip(await pageText(r.url, ms), maxChars) })));
  return settled
    .flatMap((s) => (s.status === 'fulfilled' && s.value.text.length > 300 ? [s.value] : []))
    .slice(0, count);
}
