import type { SearchResult } from '../shared/types';
import { personSubject } from './entity';
import { BROWSER_UA, focusPage, htmlToText } from './pages';

const SEASON = /\b(pre-?season|post-?season|playoffs?)\b/i;

/** The player page linked from a basketball-reference search, when the label is this person. */
export function playerPageUrl(html: string, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const match of html.matchAll(/<a href="(\/players\/[a-z]\/[a-z0-9]+\.html)">([^<]+)<\/a>/gi)) {
    const label = match[2]!.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!label.startsWith(want)) continue;
    return `https://www.basketball-reference.com${match[1]}`;
  }
  return undefined;
}

/** The sentence that states the asked season's line, once the bio has been skipped. */
export function preseasonSnippet(text: string, query: string): string | undefined {
  const asked = SEASON.exec(query)?.[1]?.toLowerCase().replace('-', '');
  if (!asked) return undefined;
  const needle = asked.startsWith('playoff') ? 'playoff' : asked;
  const focused = focusPage(text, query, 6000);
  const tailAt = focused.lastIndexOf('\n…\n');
  const tail = tailAt >= 0 ? focused.slice(tailAt + 3) : focused;
  const lower = tail.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return undefined;
    const window = tail.slice(Math.max(0, at - 120), at + 260).replace(/\s+/g, ' ').trim();
    if (/\d/.test(window) && /\b(?:points|pts|rebounds|scored|assists)\b/i.test(window)) {
      const dated = window.search(/\b\d{1,2}\/\d{1,2}\b/);
      return (dated > 0 ? window.slice(dated) : window).slice(0, 320);
    }
    from = at + needle.length;
  }
  return undefined;
}

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(4000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * One keyless lookup of the player's own page. Web results for a preseason ask are often
 * the career table or last season, and sometimes miss the player page entirely.
 */
export async function playerStatRow(query: string): Promise<SearchResult | undefined> {
  if (!SEASON.test(query)) return undefined;
  const name = personSubject(query);
  if (!name || name.split(/\s+/).length < 2) return undefined;
  try {
    const found = await getHtml(`https://www.basketball-reference.com/search/search.fcgi?search=${encodeURIComponent(name)}`);
    const url = playerPageUrl(found, name);
    if (!url) return undefined;
    const text = htmlToText(await getHtml(url));
    const snippet = preseasonSnippet(text, query);
    if (!snippet) return undefined;
    return {
      title: name,
      url,
      snippet,
      domain: 'basketball-reference.com',
      engines: ['reference'],
      content: focusPage(text, query, 6000),
    };
  } catch {
    return undefined;
  }
}
