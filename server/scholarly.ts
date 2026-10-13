import type { SearchResult } from '../shared/types';

/**
 * SPD-C4 (t457): a scholarly lane for paper/DOI asks. Web engines (LangSearch especially) return
 * news and PubMed stubs without DOIs, so "3 peer-reviewed papers with DOIs" came back with 2
 * sources and no DOI. Crossref is the fallback when OpenAlex rate-limits the edge. Single-paper lookups ("the original paper that introduced X") stay on the web:
 * OpenAlex relevance ranks follow-up work above the original there. OpenAlex is keyless and free (CC0 metadata); each work becomes a source whose
 * text states title, authors, year, venue and DOI, plus the abstract when OpenAlex has one.
 */
export const PAPER_ASK = /\b(?:peer[- ]reviewed|dois?|journal articles?|meta[- ]analys[ie]s|systematic reviews?|scholarly|preprints?|(?:research|academic|scientific) papers?|papers (?:on|about|regarding|by|that)|what (?:does|do) (?:the )?research|research (?:says|shows|on|about|into|suggests)|scientific (?:evidence|literature|consensus)|clinical trials?|according to (?:a |the )?(?:study|studies|paper|trial)|(?:the )?study (?:on|of|found|shows|showed)|studies (?:on|of|found|show))\b/i;

const TIMEOUT_MS = 2500;
const MAX = 5;
const NOISE = new RegExp(
  String.raw`\b(?:give|me|find|list|show|shows|recommend|cite|what|which|are|is|does|do|say|says|the|a|an|some|any|good|key|top|best|recent|real|actual|please|three|five|ten|\d+|peer[- ]reviewed|papers?|studies|study|articles?|journal|scholarly|research|academic|sources?|with|their|its|and|or|dois?|doi|authors?|venue|arxiv|ids?|original|that|introduced|introduce|first|on|about|regarding|for|of|in|to)\b`,
  'gi',
);

const AUTHOR_STOP = new Set(['give', 'what', 'which', 'when', 'where', 'find', 'show', 'list', 'does', 'do', 'the', 'and', 'for', 'how', 'who', 'why', 'peer', 'reviewed']);

/**
 * A paper question that names an author and a year ("Ekelund 2016"). A DOI from another year
 * is a different paper and must not be cited. Undefined when either piece is missing.
 */
export function paperAnchor(query: string): { author: string; year: number } | undefined {
  const year = query.match(/\b((?:19|20)\d{2})\b/);
  if (!year) return undefined;
  const author = query.split(/\s+/).map((word) => word.replace(/[^A-Za-z'-]/g, '')).find((word) => /^[A-Z][a-z]{3,}$/.test(word) && !AUTHOR_STOP.has(word.toLowerCase()));
  if (!author) return undefined;
  return { author: author.toLowerCase(), year: Number(year[1]) };
}

export function workMatches(work: { publication_year?: number; authorships?: { author?: { display_name?: string } }[] }, anchor: { author: string; year: number }): boolean {
  if (work.publication_year !== anchor.year) return false;
  return (work.authorships ?? []).some((row) => (row.author?.display_name ?? '').toLowerCase().includes(anchor.author));
}

/** "Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs" → "sleep deprivation working memory". */
export function paperTopic(query: string): string {
  return query
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Work = {
  doi?: string;
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

function abstractOf(index: Work['abstract_inverted_index']): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, at] of Object.entries(index)) for (const i of at) if (i < 400) words[i] = word;
  return words.filter(Boolean).join(' ');
}

export function workToResult(w: Work & { abstract?: string }): SearchResult | undefined {
  const doi = w.doi?.replace(/^https?:\/\/doi\.org\//i, '');
  if (!doi || !w.title) return undefined;
  const names = (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n);
  const authors = names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
  const venue = w.primary_location?.source?.display_name ?? '';
  const year = w.publication_year ? String(w.publication_year) : '';
  const meta = [authors && `Authors: ${authors}`, year && `Published: ${year}`, venue && `Venue: ${venue}`, `DOI: ${doi}`, `Cited by ${w.cited_by_count ?? 0} works`].filter(Boolean).join('. ');
  const abstract = w.abstract || abstractOf(w.abstract_inverted_index);
  return {
    title: w.title,
    url: `https://doi.org/${doi}`,
    snippet: `${meta}.`.slice(0, 300),
    domain: 'doi.org',
    engines: ['web'],
    ...(year ? { date: year } : {}),
    content: `${w.title}\n${meta}.${abstract ? `\n\nAbstract: ${abstract}` : ''}`,
  };
}

type CrossrefItem = {
  DOI?: string;
  title?: string[];
  issued?: { 'date-parts'?: (number | null)[][] };
  'container-title'?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  'is-referenced-by-count'?: number;
  abstract?: string;
};

/** Crossref work → the same Work shape (abstract is JATS markup; tags dropped). */
export function crossrefToWork(c: CrossrefItem): Work & { abstract?: string } {
  return {
    doi: c.DOI,
    title: c.title?.[0],
    publication_year: c.issued?.['date-parts']?.[0]?.[0] ?? undefined,
    cited_by_count: c['is-referenced-by-count'],
    authorships: (c.author ?? []).map((a) => ({ author: { display_name: a.name ?? [a.given, a.family].filter(Boolean).join(' ') } })),
    primary_location: { source: c['container-title']?.[0] ? { display_name: c['container-title'][0] } : null },
    abstract: c.abstract?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'zo-search (scholarly lane)' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as T;
}

/** OpenAlex first; Crossref when OpenAlex refuses (it rate-limits shared edge IPs). */
async function works(topic: string): Promise<{ via: string; works: (Work & { abstract?: string })[] }> {
  try {
    const data = await getJson<{ results?: Work[] }>(`https://api.openalex.org/works?search=${encodeURIComponent(topic)}&filter=has_doi:true&per_page=8&select=doi,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index`);
    if (data.results?.length) return { via: 'openalex', works: data.results };
  } catch {
    /* fall through to Crossref */
  }
  const data = await getJson<{ message?: { items?: CrossrefItem[] } }>(`https://api.crossref.org/works?query=${encodeURIComponent(topic)}&filter=type:journal-article&rows=20&select=DOI,title,issued,container-title,author,is-referenced-by-count,abstract`);
  // Crossref relevance puts meeting abstracts (0 citations) beside real papers; keep the 20 most relevant, most-cited first.
  const items = (data.message?.items ?? []).map(crossrefToWork).sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0));
  return { via: 'crossref', works: items };
}

const DOI_IN_URL = /10\.\d{4,9}\/[^\s?#]+/i;

/** A paper's title has to share the question's topic. An unrelated DOI, whatever its year, does not. */
export function paperOnTopic(query: string, title: string, snippet = ''): boolean {
  const topic = paperTopic(query).toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  if (topic.length < 2) return true;
  const text = `${title} ${snippet}`.toLowerCase();
  const hit = topic.filter((word) => text.includes(word));
  return hit.length >= Math.min(2, topic.length);
}

export function isDoiResult(row: { url?: string; title?: string; snippet?: string }): boolean {
  return DOI_IN_URL.test(`${row.url ?? ''} ${row.title ?? ''} ${row.snippet ?? ''}`);
}

/** On a research question, a DOI stays only when that paper is about the question. */
export function dropStrayDois<T extends { url?: string; title?: string; snippet?: string }>(query: string, rows: readonly T[]): T[] {
  if (!PAPER_ASK.test(query)) return [...rows];
  return rows.filter((row) => !isDoiResult(row) || paperOnTopic(query, row.title ?? '', row.snippet ?? ''));
}

/** Up to five works for a paper ask; [] on any failure (the web results still stand). */
export async function scholarlyResults(query: string): Promise<SearchResult[]> {
  if (!PAPER_ASK.test(query)) return [];
  const topic = paperTopic(query);
  if (topic.length < 3) return [];
  const started = Date.now();
  try {
    const found = await works(topic);
    const anchor = paperAnchor(query);
    const matched = anchor ? found.works.filter((work) => workMatches(work, anchor)) : found.works;
    const out = matched.map(workToResult).filter((r): r is SearchResult => !!r && paperOnTopic(query, r.title, r.snippet)).slice(0, MAX);
    console.log(JSON.stringify({ zo: 'scholar', via: found.via, n: out.length, ms: Date.now() - started }));
    return out;
  } catch (err) {
    console.log(JSON.stringify({ zo: 'scholar', n: 0, ms: Date.now() - started, error: String(err instanceof Error ? err.message : err).slice(0, 60) }));
    return [];
  }
}

/** Scholarly sources first (they carry the DOIs), then the web results that are not the same DOI. */
export function withScholarly(scholar: readonly SearchResult[], web: readonly SearchResult[]): SearchResult[] {
  if (!scholar.length) return [...web];
  const dois = new Set(scholar.map((r) => r.url.toLowerCase()));
  const doiOf = (u: string) => u.toLowerCase().match(/10\.\d{4,9}\/[^\s?#]+/)?.[0];
  const known = new Set(scholar.map((r) => doiOf(r.url)));
  return [...scholar, ...web.filter((r) => !dois.has(r.url.toLowerCase()) && !(doiOf(r.url) && known.has(doiOf(r.url))))];
}
