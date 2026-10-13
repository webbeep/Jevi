import { stripHtml } from '../shared/text';
import { clip, fetchJsonCapped } from './util';

/** Wikimedia asks for a contact in the User-Agent. This is the search step only. */
export const WIKI_UA = 'ZO/1.0 (antigravity0309.2@gmail.com)';

/** Bytes of JSON the search step will parse. A real 5-hit reply is about 2 KB. */
export const WIKI_BODY_CAP = 32_768;

const ENGINE_TIMEOUT_MS = 6500;

export interface WikiHit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

interface WikiRow {
  title?: string;
  snippet?: string;
  timestamp?: string;
}

/** MediaWiki `list=search` payload. The snippet is the extract; a second extracts call is not made. */
export function parseWikiSearch(data: unknown): WikiHit[] {
  const rows = (data as { query?: { search?: WikiRow[] } } | null)?.query?.search;
  if (!Array.isArray(rows)) return [];
  const hits: WikiHit[] = [];
  for (const row of rows) {
    if (hits.length >= 5) break;
    const title = row?.title?.trim();
    if (!title) continue;
    const snippet = stripHtml(row.snippet ?? '');
    hits.push({
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      snippet: clip(snippet, 320),
      date: row.timestamp,
    });
  }
  return hits;
}

export async function fetchWikiSearch(q: string): Promise<WikiHit[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&origin=*&srprop=snippet%7Ctimestamp&srsearch=${encodeURIComponent(q)}`;
  const data = await fetchJsonCapped<unknown>(url, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } }, ENGINE_TIMEOUT_MS, WIKI_BODY_CAP);
  return parseWikiSearch(data);
}

/** REST summary shape for the exact article and its lead image. */
interface WikiSummary {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

/**
 * Keyless Wikipedia disambiguation lookup for bare person names (0 Serper).
 * Tries `Name (disambiguation)` then `Name`; returns a synthetic hit when the
 * extract says "may refer to" or "may also refer to".
 */
const DISAMBIG_MS = 1200;

async function wikiSummary(title: string): Promise<WikiHit | null> {
  // The REST summary for a disambiguation page is one sentence and drops the list.
  // The extract includes the other people ("Michael B. Jordan"), which the summary never does.
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json`;
  try {
    const data = await fetchJsonCapped<{ query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> } }>(
      url,
      { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
      DISAMBIG_MS,
      WIKI_BODY_CAP,
    );
    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || page.missing != null) return null;
    const extract = (page.extract ?? '').replace(/\s+/g, ' ').trim();
    // "may also refer to" is the list. A thin page with neither phrase must not split a famous name.
    if (!/\bmay (?:also )?refer to\b/i.test(extract) || extract.length < 40) return null;
    const pageTitle = page.title ?? title;
    const hit = {
      title: pageTitle,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
      snippet: clip(extract, 1400),
    };
    // A parenthetical namesake ("Michael Jordan (footballer)") is not enough. Obama's list is full of those.
    // A middle initial ("Michael B. Jordan") is a second person, so that list is worth showing.
    const asked = title.replace(/\s*\(disambiguation\)\s*$/i, '').trim().split(/\s+/).filter(Boolean);
    if (asked.length >= 2) {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const middle = new RegExp(`${esc(asked[0]!)}\\s+[A-Z]\\.\\s+${esc(asked[asked.length - 1]!)}`, 'i');
      if (!middle.test(`${hit.title} ${hit.snippet}`)) return null;
    }
    return hit;
  } catch {
    return null;
  }
}

export async function fetchWikiDisambiguation(name: string): Promise<WikiHit | null> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.split(' ').length < 2) return null;
  // Both titles at once. The old loop waited out a slow 404 before trying the name itself.
  const [listed, plain] = await Promise.all([wikiSummary(`${clean} (disambiguation)`), wikiSummary(clean)]);
  return listed ?? plain;
}

/**
 * The exact Wikipedia article for a bare name (keyless). The same article comes back on every
 * ask, so a picker decision does not flip when the backup engines omit it. A disambiguation
 * page is not this article.
 */
export async function fetchWikiArticle(name: string): Promise<WikiHit | null> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.split(' ').length < 2) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean.replace(/ /g, '_'))}`;
  try {
    const data = await fetchJsonCapped<WikiSummary>(
      url,
      { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
      DISAMBIG_MS,
      WIKI_BODY_CAP,
    );
    if (data.type === 'disambiguation') return null;
    const title = (data.title ?? '').trim();
    if (!title || title.toLowerCase() !== clean.toLowerCase()) return null;
    const extract = (data.extract ?? '').replace(/\s+/g, ' ').trim();
    if (!extract || /\bmay refer to\b/i.test(extract)) return null;
    const page = data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    return { title, url: page, snippet: clip(extract, 320) };
  } catch {
    return null;
  }
}


/** REST summary lead image (keyless, 0 Serper) for a kept en.wikipedia.org/wiki/<Title> row. */
export async function fetchWikiLeadImage(pageUrl: string): Promise<{ title: string; description?: string; thumb: string; url: string } | null> {
  const m = /^https:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/i.exec(pageUrl);
  if (!m) return null;
  let title: string;
  try {
    title = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  if (/\(disambiguation\)/i.test(title)) return null;
  try {
    const data = await fetchJsonCapped<WikiSummary & { description?: string; thumbnail?: { source?: string } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
      2500,
      WIKI_BODY_CAP,
    );
    if (data.type === 'disambiguation') return null;
    const thumb = data.thumbnail?.source;
    if (!thumb || !/^https:\/\//i.test(thumb)) return null;
    return { title: data.title ?? title.replace(/_/g, ' '), description: data.description, thumb, url: data.content_urls?.desktop?.page ?? pageUrl };
  } catch {
    return null;
  }
}
