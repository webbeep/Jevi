/** A trending search, already in the wording the home list shows and searches. */
export interface TrendQuery {
  query: string;
}

/** Six rows fit under the search bar on a phone without a list of their own to scroll. */
export const TRENDING_LIMIT = 6;

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function capWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && SMALL.has(lower)) return lower;
  const mc = lower.match(/^mc([a-z].+)$/);
  if (mc) return `Mc${mc[1].charAt(0).toUpperCase()}${mc[1].slice(1)}`;
  if (word !== lower && word !== word.toUpperCase()) return word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Title case a search, leaving small words lower except at the start. */
export function titleQuery(raw: string): string {
  return decode(raw).split(' ').filter(Boolean).map(capWord).join(' ');
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

/** True when every word of `short` already appears in the longer query. */
function coveredBy(short: string[], longer: string[]): boolean {
  if (short.length === 0 || short.length >= longer.length) return false;
  const have = new Set(longer);
  return short.every((word) => have.has(word));
}

/**
 * Daily search trends from a Google Trends RSS body.
 * Feed order is kept. A shorter query is dropped when a longer one already names the same thing
 * ("Gibbs" beside "Jahmyr Gibbs"). The list stops at `limit`.
 */
export function parseTrendsRss(xml: string, limit = TRENDING_LIMIT): TrendQuery[] {
  const rows: { title: string; words: string[] }[] = [];
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = item[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!title) continue;
    const text = decode(title);
    const words = wordsOf(text);
    if (!text || words.length === 0) continue;
    rows.push({ title: text, words });
  }
  const kept: TrendQuery[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length && kept.length < limit; i++) {
    const row = rows[i];
    const redundant = rows.some((other, j) => j !== i && coveredBy(row.words, other.words));
    if (redundant) continue;
    const query = titleQuery(row.title);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    kept.push({ query });
  }
  return kept;
}
