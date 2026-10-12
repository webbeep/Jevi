/** A trending search, already in the wording the home list shows and searches. */
export interface TrendQuery {
  query: string;
}

/** Six rows fit under the search bar on a phone without a list of their own to scroll. */
export const TRENDING_LIMIT = 6;
/** Extra rows kept so a recent search can pull a match into those six. */
export const TRENDING_POOL = 15;
/** At most this many of the six rows move up because they match a recent search. */
export const TRENDING_TAILOR = 2;

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);
/** Words that show up in almost every search and should not count as a shared topic. */
const TREND_STOP = new Set([
  ...SMALL,
  'about', 'are', 'best', 'from', 'get', 'got', 'how', 'into', 'live', 'new', 'news', 'one', 'out',
  'that', 'this', 'today', 'top', 'two', 'was', 'were', 'what', 'when', 'where', 'who', 'why', 'with', 'you', 'your',
]);

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

function contentWords(text: string): string[] {
  return wordsOf(text).filter((word) => word.length >= 3 && !TREND_STOP.has(word));
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

/**
 * Country trends, nudged by recent searches on this device.
 * Up to `slots` rows that share a topic word move to the front. The rest stay in feed order.
 * No history, or no shared topic, leaves the first `limit` rows as they arrived.
 */
export function tailorTrends(
  pool: readonly TrendQuery[],
  recent: readonly string[],
  limit = TRENDING_LIMIT,
  slots = TRENDING_TAILOR,
): TrendQuery[] {
  const source = pool.filter((item) => item.query.trim());
  const recentWords = recent.map(contentWords).filter((words) => words.length > 0).slice(0, 8);
  const matches: { item: TrendQuery; index: number; recency: number }[] = [];
  if (recentWords.length) {
    source.forEach((item, index) => {
      const words = new Set(contentWords(item.query));
      if (words.size === 0) return;
      const recency = recentWords.findIndex((row) => row.some((word) => words.has(word)));
      if (recency >= 0) matches.push({ item, index, recency });
    });
  }
  matches.sort((a, b) => a.recency - b.recency || a.index - b.index);
  const chosen = new Set<string>();
  const out: TrendQuery[] = [];
  for (const match of matches) {
    if (out.length >= slots || out.length >= limit) break;
    const key = match.item.query.toLowerCase();
    if (chosen.has(key)) continue;
    chosen.add(key);
    out.push(match.item);
  }
  for (const item of source) {
    if (out.length >= limit) break;
    const key = item.query.toLowerCase();
    if (chosen.has(key)) continue;
    chosen.add(key);
    out.push(item);
  }
  return out;
}
