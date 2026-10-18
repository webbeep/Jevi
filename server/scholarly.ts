import type { SearchResult } from '../shared/types';

/**
 * A scholarly lane for paper / DOI / PMC / arXiv asks. Web engines return news and PubMed stubs
 * without identifiers, so a request for papers came back with two sources and no DOI. OpenAlex,
 * Crossref, and the arXiv Atom API run in parallel (all keyless). Crossref still covers OpenAlex
 * rate-limits on the edge. Single-paper lookups ("the original paper that introduced X") stay on
 * the web: catalog relevance ranks follow-up work above the original there. Consumer "paper"
 * (towels, toilet paper) also stays on the web.
 */
export const PAPER_ASK = /\b(?:peer[- ]reviewed|dois?|pmc(?:\s+ids?)?|pubmed|pmids?|journal articles?|meta[- ]analys[ie]s|systematic reviews?|scholarly|preprints?|\barxiv\b|(?:research|academic|scientific|scholarly) (?:papers?|publications?|articles?|literature)|academic publications?|(?:papers?|publications?|articles?) (?:on|about|regarding|by|that|with)|what (?:does|do) (?:the )?research|what (?:did|do|does) (?:the |a )?(?:studies|study|research|papers?)|research (?:says|shows|on|about|into|suggests)|scientific (?:evidence|literature|consensus)|clinical trials?|according to (?:a |the )?(?:study|studies|paper|trial)|(?:the )?study (?:on|of|found|shows|showed)|studies (?:on|of|found|find|show)|papers?)\b/i;

const CONSUMER_PAPER = /\b(?:toilet|wax|wrapping|tissue|baking|butcher|sand)\s*papers?\b|\bpapers?\s+towels?\b|\b(?:wall|news|term)\s*papers?\b/i;
const ORIGINAL_PAPER = /\boriginal papers? that introduced\b/i;

export function isPaperAsk(query: string): boolean {
  if (CONSUMER_PAPER.test(query) || ORIGINAL_PAPER.test(query)) return false;
  return PAPER_ASK.test(query);
}

/** An arXiv or preprint ask, not a DOI/PMC journal hunt. Journal-paper asks keep doi.org and PMC first. */
export function isPreprintAsk(query: string): boolean {
  return isPaperAsk(query) && /\b(?:arxiv|preprints?)\b/i.test(query) && !/\b(?:dois?|pmc|pubmed|pmids?)\b/i.test(query);
}

const TIMEOUT_MS = 1800;
const MAX = 5;
const NOISE = new RegExp(
  String.raw`\b(?:give|me|find|list|show|shows|recommend|cite|what|which|are|is|does|do|say|says|the|a|an|some|any|good|key|top|best|recent|real|actual|please|three|five|ten|\d+|peer[- ]reviewed|papers?|publications?|studies|study|articles?|journal|scholarly|research|academic|scientific|literature|sources?|with|their|its|and|or|dois?|doi|pmc|pubmed|pmid|pmids?|authors?|venue|arxiv|preprints?|ids?|original|that|introduced|introduce|first|on|about|regarding|for|of|in|to)\b`,
  'gi',
);

const AUTHOR_STOP = new Set(['give', 'what', 'which', 'when', 'where', 'find', 'show', 'list', 'does', 'do', 'the', 'and', 'for', 'how', 'who', 'why', 'peer', 'reviewed']);

const UA = 'zo-search/1.0 (https://zo.fyi; ask@zo.fyi)';
const ARXIV_ID = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*|\/arxiv\.)(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/i;
const ARXIV_DOI = /^10\.48550\/arxiv\./i;
const DOI_IN_URL = /10\.\d{4,9}\/[^\s?#]+/i;

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

export type Work = {
  doi?: string;
  arxivId?: string;
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  abstract?: string;
  /** PubMed tags this work as a randomized controlled trial. */
  trial?: boolean;
};

function abstractOf(index: Work['abstract_inverted_index']): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, at] of Object.entries(index)) for (const i of at) if (i < 400) words[i] = word;
  return words.filter(Boolean).join(' ');
}

export function normalizeDoi(doi?: string): string | undefined {
  const d = doi?.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:/i, '').replace(/\/+$/, '').toLowerCase();
  return d || undefined;
}

export function normalizeArxivId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const fromUrl = trimmed.match(ARXIV_ID)?.[1];
  const id = (fromUrl ?? trimmed.replace(/^arxiv:/i, '')).replace(/v\d+$/i, '').replace(/\.pdf$/i, '');
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/i.test(id)) return undefined;
  return id.toLowerCase();
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

function arxivIdOf(work: Work): string | undefined {
  const doi = normalizeDoi(work.doi);
  return work.arxivId
    ?? normalizeArxivId(work.primary_location?.landing_page_url ?? undefined)
    ?? (doi && ARXIV_DOI.test(doi) ? normalizeArxivId(doi) : undefined);
}

/** One arXiv Atom entry → the shared Work shape. */
export function arxivToWork(entry: string): Work {
  const id = normalizeArxivId(xmlTag(entry, 'id')) ?? normalizeArxivId(entry);
  const doi = normalizeDoi(xmlTag(entry, 'arxiv:doi')) ?? normalizeDoi(xmlTag(entry, 'doi'));
  const published = xmlTag(entry, 'published');
  const year = published.match(/^(\d{4})/)?.[1];
  const names = [...entry.matchAll(/<author\b[\s\S]*?<name>([\s\S]*?)<\/name>/gi)].map((m) => decodeXml(m[1])).filter(Boolean);
  const venue = xmlTag(entry, 'arxiv:journal_ref') || (id ? 'arXiv' : '');
  return {
    doi,
    arxivId: id,
    title: xmlTag(entry, 'title'),
    publication_year: year ? Number(year) : undefined,
    authorships: names.map((display_name) => ({ author: { display_name } })),
    primary_location: { source: venue ? { display_name: venue } : null },
    abstract: xmlTag(entry, 'summary'),
  };
}

export function parseArxivFeed(xml: string): Work[] {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => arxivToWork(m[0])).filter((w) => w.title && (w.arxivId || w.doi));
}

export function workToResult(w: Work, preferArxiv = false): SearchResult | undefined {
  if (!w.title) return undefined;
  const doi = normalizeDoi(w.doi);
  const arxivId = w.arxivId ?? (doi && ARXIV_DOI.test(doi) ? normalizeArxivId(doi) : undefined);
  if (!doi && !arxivId) return undefined;
  const journalDoi = doi && !ARXIV_DOI.test(doi) ? doi : undefined;
  const useArxiv = !!arxivId && (preferArxiv || !journalDoi);
  const url = useArxiv ? `https://arxiv.org/abs/${arxivId}` : journalDoi ? `https://doi.org/${journalDoi}` : `https://doi.org/${doi}`;
  const domain = useArxiv ? 'arxiv.org' : 'doi.org';
  const names = (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n);
  const authors = names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
  const venue = w.primary_location?.source?.display_name ?? '';
  const year = w.publication_year ? String(w.publication_year) : '';
  const ids = [journalDoi && `DOI: ${journalDoi}`, arxivId && `arXiv: ${arxivId}`, doi && !journalDoi && `DOI: ${doi}`].filter(Boolean);
  const meta = [authors && `Authors: ${authors}`, year && `Published: ${year}`, venue && `Venue: ${venue}`, ...ids, `Cited by ${w.cited_by_count ?? 0} works`].filter(Boolean).join('. ');
  const abstract = w.abstract || abstractOf(w.abstract_inverted_index);
  return {
    title: w.title,
    url,
    snippet: `${meta}.`.slice(0, 300),
    domain,
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
export function crossrefToWork(c: CrossrefItem): Work {
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
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string, accept: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.text();
}

async function openAlexWorks(topic: string, preprint = false): Promise<Work[]> {
  const filter = preprint ? '' : '&filter=has_doi:true';
  const data = await getJson<{ results?: Work[] }>(`https://api.openalex.org/works?search=${encodeURIComponent(topic)}${filter}&per_page=8&select=doi,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index`);
  return (data.results ?? []).map((work) => ({ ...work, arxivId: arxivIdOf(work) }));
}

async function crossrefWorks(topic: string): Promise<Work[]> {
  const data = await getJson<{ message?: { items?: CrossrefItem[] } }>(`https://api.crossref.org/works?query=${encodeURIComponent(topic)}&filter=type:journal-article&rows=20&select=DOI,title,issued,container-title,author,is-referenced-by-count,abstract`);
  // Crossref relevance puts meeting abstracts (0 citations) beside real papers; keep the 20 most relevant, most-cited first.
  return (data.message?.items ?? []).map(crossrefToWork).sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0));
}

/** "randomized trials of semaglutide", "RCTs", "clinical trials": the ask is for trials, not any paper on the topic. */
const TRIAL_ASK = /\b(?:randomi[sz]ed|rcts?|(?:clinical|controlled) trials?|trials?)\b/i;
const TRIAL_WORDS = /\b(?:randomi[sz]ed|controlled|clinical|rcts?|trials?)\b/gi;
/** A review, a pooled analysis or a protocol is about trials. It is not one. */
const NOT_A_TRIAL = /\b(?:systematic review|meta-?analys[ie]s|review|protocol|rationale and design|design and rationale|pooled analysis|post hoc|strategies)\b/i;

export function isTrialAsk(query: string): boolean {
  return isPaperAsk(query) && TRIAL_ASK.test(query);
}

type PubmedSummary = { title?: string; pubdate?: string; fulljournalname?: string; source?: string; authors?: { name?: string }[]; articleids?: { idtype?: string; value?: string }[]; pubtype?: string[] };

/**
 * Randomized controlled trials from PubMed (keyless), which tags each article with its study design,
 * so a review or a protocol never stands in for a trial. Most relevant first.
 */
async function pubmedTrials(topic: string): Promise<Work[]> {
  const subject = topic.replace(TRIAL_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (subject.length < 3) return [];
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const term = encodeURIComponent(`${subject} AND randomized controlled trial[pt]`);
  const found = await getJson<{ esearchresult?: { idlist?: string[] } }>(`${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&tool=zo&term=${term}`);
  const ids = found.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const summary = await getJson<{ result?: Record<string, PubmedSummary> & { uids?: string[] } }>(`${base}/esummary.fcgi?db=pubmed&retmode=json&tool=zo&id=${ids.join(',')}`);
  const result = summary.result;
  if (!result) return [];
  return ids.flatMap((id): Work[] => {
    const row = result[id] as PubmedSummary | undefined;
    const doi = row?.articleids?.find((item) => item.idtype === 'doi')?.value;
    if (!row?.title || !doi) return [];
    const year = Number(row.pubdate?.match(/\b(19|20)\d{2}\b/)?.[0]);
    return [{
      doi,
      title: row.title.replace(/\.$/, ''),
      publication_year: Number.isFinite(year) ? year : undefined,
      authorships: (row.authors ?? []).map((author) => ({ author: { display_name: author.name } })),
      primary_location: { source: { display_name: row.fulljournalname ?? row.source ?? '' } },
      abstract: (row.pubtype ?? []).join(', '),
      trial: true,
    }];
  });
}

async function arxivWorks(topic: string): Promise<Work[]> {
  const q = encodeURIComponent(topic);
  const paths = [
    `https://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=8&sortBy=relevance&sortOrder=descending`,
    `https://arxiv.org/api/query?search_query=${q}&start=0&max_results=8&sortBy=relevance&sortOrder=descending`,
    `http://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=8&sortBy=relevance&sortOrder=descending`,
  ];
  let last: unknown;
  for (const url of paths) {
    try {
      const parsed = parseArxivFeed(await getText(url, 'application/atom+xml', 3000));
      if (parsed.length) return parsed;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('arxiv empty');
}

function settledWorks(label: string, settled: PromiseSettledResult<Work[]>): { via: string; works: Work[] } | undefined {
  if (settled.status !== 'fulfilled' || !settled.value.length) return undefined;
  return { via: label, works: settled.value };
}

/**
 * One paper from several catalogs. A journal DOI wins over an arXiv-only copy of the same work.
 * First-seen order is OpenAlex, then Crossref, then arXiv, so peer-reviewed rows lead.
 */
export function mergeWorks(groups: { via: string; works: Work[] }[]): { via: string; works: Work[] } {
  const byDoi = new Map<string, Work>();
  const byArxiv = new Map<string, Work>();
  const out: Work[] = [];
  const remember = (work: Work) => {
    const doi = normalizeDoi(work.doi);
    const ax = work.arxivId ?? (doi && ARXIV_DOI.test(doi) ? normalizeArxivId(doi) : undefined);
    if (doi) byDoi.set(doi, work);
    if (ax) byArxiv.set(ax, work);
  };
  const add = (incoming: Work) => {
    const doi = normalizeDoi(incoming.doi);
    const ax = incoming.arxivId ?? (doi && ARXIV_DOI.test(doi) ? normalizeArxivId(doi) : undefined);
    const have = (doi && byDoi.get(doi)) || (ax && byArxiv.get(ax)) || undefined;
    if (have) {
      if (!have.arxivId && ax) have.arxivId = ax;
      if (!have.doi && doi) have.doi = doi;
      if ((incoming.cited_by_count ?? 0) > (have.cited_by_count ?? 0)) have.cited_by_count = incoming.cited_by_count;
      if (!have.abstract && incoming.abstract) have.abstract = incoming.abstract;
      if (!have.abstract_inverted_index && incoming.abstract_inverted_index) have.abstract_inverted_index = incoming.abstract_inverted_index;
      return;
    }
    out.push(incoming);
    remember(incoming);
  };
  for (const group of groups) for (const work of group.works) add(work);
  return { via: groups.map((g) => g.via).join('+') || 'none', works: out };
}

/** OpenAlex, Crossref, and arXiv in parallel. Any empty or failing catalog is skipped. */
async function works(topic: string, preprint = false, trials = false): Promise<{ via: string; works: Work[] }> {
  const [pm, oa, cr, ax] = await Promise.allSettled([trials ? pubmedTrials(topic) : Promise.resolve([]), openAlexWorks(topic, preprint), crossrefWorks(topic), arxivWorks(topic)]);
  // Trials tagged by PubMed lead: the catalogs rank reviews of those trials above the trials themselves.
  return mergeWorks([settledWorks('pubmed', pm), settledWorks('openalex', oa), settledWorks('crossref', cr), settledWorks('arxiv', ax)].filter((g): g is { via: string; works: Work[] } => !!g));
}

/** On a trial ask, a review or protocol is dropped, and a PubMed-tagged trial goes first. */
export function trialsFirst(found: Work[], query: string): Work[] {
  if (!isTrialAsk(query)) return found;
  const trials = found.filter((work) => !NOT_A_TRIAL.test(work.title ?? ''));
  return [...trials.filter((work) => work.trial), ...trials.filter((work) => !work.trial)];
}

/** A paper's title has to share the question's topic. An unrelated DOI, whatever its year, does not. */
export function paperOnTopic(query: string, title: string, snippet = ''): boolean {
  // "randomized trials" says what kind of paper, not what it is about: an ML paper on trial analysis is off topic.
  const topic = paperTopic(query).replace(TRIAL_WORDS, ' ').toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  if (topic.length < 2) return true;
  const text = `${title} ${snippet}`.toLowerCase();
  const hit = topic.filter((word) => text.includes(word));
  return hit.length >= Math.min(2, topic.length);
}

export function isDoiResult(row: { url?: string; title?: string; snippet?: string }): boolean {
  return DOI_IN_URL.test(`${row.url ?? ''} ${row.title ?? ''} ${row.snippet ?? ''}`);
}

/** A clinic or consumer-health page is not a paper, even on a research question. */
const CLINIC_HOST = /(?:^|\.)(?:mayoclinic\.org|webmd\.com|healthline\.com|clevelandclinic\.org|medicalnewstoday\.com|verywellhealth\.com|hopkinsmedicine\.org|health\.harvard\.edu)$/i;

export function isClinicPage(url: string): boolean {
  try {
    return CLINIC_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** On a paper ask, a health-information page is not one of the papers. A DOI page stays. */
export function dropClinicPages<T extends { url?: string; title?: string; snippet?: string }>(query: string, rows: readonly T[]): T[] {
  if (!isPaperAsk(query)) return [...rows];
  return rows.filter((row) => !row.url || isDoiResult(row) || !isClinicPage(row.url));
}

/** On a research question, a DOI stays only when that paper is about the question. */
export function dropStrayDois<T extends { url?: string; title?: string; snippet?: string }>(query: string, rows: readonly T[]): T[] {
  if (!isPaperAsk(query)) return [...rows];
  return rows.filter((row) => !isDoiResult(row) || paperOnTopic(query, row.title ?? '', row.snippet ?? ''));
}

function paperKey(url: string): string {
  const lower = url.toLowerCase();
  const doi = lower.match(/10\.\d{4,9}\/[^\s?#]+/)?.[0];
  if (doi) {
    if (ARXIV_DOI.test(doi)) return `arxiv:${normalizeArxivId(doi) ?? doi}`;
    return `doi:${doi}`;
  }
  const ax = normalizeArxivId(lower);
  return ax ? `arxiv:${ax}` : lower;
}

function journalDoi(work: Work): boolean {
  const doi = normalizeDoi(work.doi);
  return !!doi && !ARXIV_DOI.test(doi);
}

function arxivRow(work: Work): boolean {
  const doi = normalizeDoi(work.doi);
  return !!work.arxivId || !!(doi && ARXIV_DOI.test(doi));
}

/**
 * Journal DOIs lead on a DOI/PMC ask. An arXiv/preprint ask leads with arXiv rows.
 * Otherwise up to two arXiv-only works stay in the five, so a preprint is not crowded out.
 */
export function pickWorks(found: Work[], query: string): Work[] {
  const preprintAsk = isPreprintAsk(query);
  const journal = found.filter(journalDoi);
  const arxivOnly = found.filter((work) => arxivRow(work) && !journalDoi(work));
  const rest = found.filter((work) => !journalDoi(work) && !arxivRow(work));
  if (preprintAsk) {
    // Journal-only DOIs bury arxiv.org when the Atom API misses; a preprint ask wants arXiv rows.
    return found.filter(arxivRow).slice(0, MAX);
  }
  const keepArxiv = Math.min(2, arxivOnly.length);
  return [...journal.slice(0, MAX - keepArxiv), ...arxivOnly, ...rest].slice(0, MAX);
}

function keysOf(row: { url: string; snippet?: string; content?: string }): string[] {
  const keys = new Set([paperKey(row.url)]);
  const blob = `${row.url} ${row.snippet ?? ''} ${row.content ?? ''}`;
  const doi = blob.toLowerCase().match(/10\.\d{4,9}\/[^\s,;]+/)?.[0];
  if (doi) keys.add(ARXIV_DOI.test(doi) ? `arxiv:${normalizeArxivId(doi) ?? doi}` : `doi:${doi.replace(/\/+$/, '')}`);
  const ax = normalizeArxivId(blob);
  if (ax) keys.add(`arxiv:${ax}`);
  return [...keys];
}

/** Up to five works for a paper ask; [] on any failure (the web results still stand). */
export async function scholarlyResults(query: string): Promise<SearchResult[]> {
  if (!isPaperAsk(query)) return [];
  const topic = paperTopic(query);
  if (topic.length < 3) return [];
  const started = Date.now();
  try {
    const preprintAsk = isPreprintAsk(query);
    const found = await works(topic, preprintAsk, isTrialAsk(query));
    const anchor = paperAnchor(query);
    const matched = anchor ? found.works.filter((work) => workMatches(work, anchor)) : found.works;
    const onTopic = trialsFirst(matched.filter((work) => paperOnTopic(query, work.title ?? '', work.abstract ?? '')), query);
    const out = pickWorks(onTopic, query).map((work) => workToResult(work, preprintAsk)).filter((r): r is SearchResult => !!r).slice(0, MAX);
    console.log(JSON.stringify({ zo: 'scholar', via: found.via, n: out.length, ms: Date.now() - started }));
    return out;
  } catch (err) {
    console.log(JSON.stringify({ zo: 'scholar', n: 0, ms: Date.now() - started, error: String(err instanceof Error ? err.message : err).slice(0, 60) }));
    return [];
  }
}

export function isArxivResult(row: { url?: string; domain?: string }): boolean {
  const domain = (row.domain ?? '').toLowerCase().replace(/^www\./, '');
  return domain === 'arxiv.org' || domain.endsWith('.arxiv.org') || !!normalizeArxivId(row.url ?? '');
}

/** pdf/html arXiv links become the abs page, so a preprint ask cites one canonical URL. */
export function toArxivAbs<T extends { url: string; domain?: string }>(row: T): T {
  const id = normalizeArxivId(row.url);
  if (!id) return row;
  return { ...row, url: `https://arxiv.org/abs/${id}`, domain: 'arxiv.org' };
}

/**
 * On a preprint ask, arxiv.org leads even when the Atom catalog missed and only web rows remain.
 * A DOI/PMC ask is left alone so journal sources stay first.
 */
export function leadPreprints<T extends { url: string; domain?: string }>(query: string, rows: readonly T[]): T[] {
  if (!isPreprintAsk(query) || !rows.length) return [...rows];
  const canon = rows.map((row) => toArxivAbs(row));
  const seen = new Set<string>();
  const arxiv: T[] = [];
  const rest: T[] = [];
  for (const row of canon) {
    if (isArxivResult(row)) {
      const key = normalizeArxivId(row.url) ?? row.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      arxiv.push(row);
    } else rest.push(row);
  }
  return [...arxiv, ...rest];
}

/** Scholarly sources first (they carry the DOIs and arXiv ids), then the web results that are not the same paper. */
export function withScholarly(scholar: readonly SearchResult[], web: readonly SearchResult[]): SearchResult[] {
  if (!scholar.length) return [...web];
  const known = new Set(scholar.flatMap(keysOf));
  return [...scholar, ...web.filter((r) => !keysOf(r).some((key) => known.has(key)))];
}

/** Catalog copy already on the row (abstract / DOI / arXiv id) — skip fetching the landing page. */
export function hasCatalogCopy(row: { content?: string }): boolean {
  const text = row.content ?? '';
  return text.length > 0 && (/\bDOI:/i.test(text) || /\barXiv:/i.test(text) || /\bAbstract:/i.test(text));
}
