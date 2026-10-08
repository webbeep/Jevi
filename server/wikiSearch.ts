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
