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

/** REST summary shape used only for disambiguation detection (keyless). */
interface WikiSummary {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

/**
 * Keyless Wikipedia disambiguation lookup for bare person names (0 Serper).
 * Tries `Name (disambiguation)` then `Name`; returns a synthetic hit when the
 * page is type=disambiguation or the extract says "may refer to".
 */
export async function fetchWikiDisambiguation(name: string): Promise<WikiHit | null> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.split(' ').length < 2) return null;
  const titles = [`${clean} (disambiguation)`, clean];
  for (const title of titles) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    try {
      const data = await fetchJsonCapped<WikiSummary>(
        url,
        { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
        ENGINE_TIMEOUT_MS,
        WIKI_BODY_CAP,
      );
      const extract = (data.extract ?? '').trim();
      // Require a real "may refer to" list — thin "(disambiguation)" pages (Obama) must not poison a famous name.
      const isDis = /\bmay refer to\b/i.test(extract);
      if (!isDis || extract.length < 40) continue;
      const page =
        data.content_urls?.desktop?.page ??
        `https://en.wikipedia.org/wiki/${encodeURIComponent((data.title ?? title).replace(/ /g, '_'))}`;
      return {
        title: data.title ?? title,
        url: page,
        snippet: clip(extract.replace(/\s+/g, ' '), 480),
      };
    } catch {
      // 404 / network — try the next title.
    }
  }
  return null;
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
