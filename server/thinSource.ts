import type { SourceBrief } from './brief';
import { isBlockPage } from './blockPage';
import type { AskScope } from './budget';
import { clipChars, deepseekFetch, deepseekSearch, type DeepSeekHit } from './deepseekTools';
import { isFetchable, type PageText } from './pages';
import { normalizeUrl } from './search';
import { hostTier, isSocialHost, isVideoHost } from './sourceQuality';
import type { SearchResponse, SearchResult } from '../shared/types';
import { type Env, clip, domainOf } from './util';

/**
 * DeepSeek reads a page only when the card depends on it and the Serper snippet
 * does not contain the fact. DeepSeek Search runs once, after Serper has already
 * returned, when those rows still do not contain the fact.
 *
 * Not used for images, entity disambiguation, live quotes, video, or a comparison's
 * per-side Serper fan-out. A miss leaves the Serper rows and images as they were.
 */

const FETCH_CAP = 2;
const READ_MS = 1800;

const LEVY = /\b(?:fees?|fines?|penalt(?:y|ies)|tolls?|dut(?:y|ies)|tariffs?|lev(?:y|ies)|surcharges?|sales tax|income tax|tax rate|vat|gst|withholding)\b/i;
const RATE = /\b(?:tax|taxes|rates?|vat|gst)\b/i;
const SPEC = /\b(?:specs?|specifications?|battery|batteries|display|screen size|weight|weights|resolution|storage|capacity|dimensions|mAh|megapixels?|refresh rate|waterproof|ip\d{2})\b/i;
const QUOTE = /\b(?:quotes?|exact words|verbatim|what did\s+\S+(?:\s+\S+){0,4}\s+say)\b/i;
const ROUNDUP = /\b(?:best|top\s+\d|reviews?|versus|comparison|roundup|vs\.?)\b/i;

const STOP = new Set([
  'the', 'and', 'for', 'with', 'what', 'how', 'much', 'many', 'are', 'was', 'from', 'that', 'this', 'your', 'about',
  'official', 'specs', 'spec', 'specifications', 'specification', 'battery', 'display', 'weight', 'resolution',
  'storage', 'capacity', 'dimensions', 'screen', 'size', 'rate', 'rates', 'fee', 'fees', 'tax', 'taxes',
]);

export type FactKind = 'levy' | 'spec' | 'quote';

export interface ThinPlan {
  kind?: FactKind;
  /** URLs of kept pages the answer depends on, whose snippets do not hold the fact. At most two. */
  fetches: string[];
  /** One Search, only when no kept page is the one to read and no snippet has the fact. */
  search: boolean;
  site?: string;
}

export interface ThinOpts {
  mode?: string;
  pattern?: string;
  quote?: boolean;
}

export interface FetchedPage {
  url: string;
  text: string;
}

const LEVY_FACT = /(?:\$|£|€|¥)\s?\d|\b\d+(?:\.\d+)?\s*(?:%|percent\b|usd\b|dollars?\b)/i;
const SPEC_FACT = /\d+(?:\.\d+)?\s*-?\s*(?:mAh|Wh|kHz|MHz|GHz|Hz|mm|cm|inches|inch|gb|tb|mp|megapixels?|kg|lbs?|oz|hours?|hrs?|nits?|watts?|days?|in|g)\b/i;
const QUOTE_FACT = /[“”«»„]|"[^"\n]{12,}"|‘[^’]{12,}’/;
const MONEY_RE = /[$£€¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
const PERCENT_RE = /\d+(?:\.\d+)?\s*(?:%|percent\b)/gi;
const MEASURE_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(mAh|Wh|kHz|MHz|GHz|Hz|mm|cm|inches|inch|gb|tb|mp|megapixels?|kg|lbs?|oz|hours?|hrs?|nits?|watts?|days?|in|g)\b/gi;
/** An optional add-on. It is not the charge the question asked for unless the question names it. */
const ADDON = /\b(?:expedit(?:e|ed|ing|ion)?|optional|additional|surcharge|add-on|addon)\b/i;

export function factKind(query: string): FactKind | undefined {
  if (QUOTE.test(query)) return 'quote';
  if (LEVY.test(query) || (RATE.test(query) && /\b(?:how much|what(?:'s| is)|rate|percent)\b/i.test(query))) return 'levy';
  if (SPEC.test(query)) return 'spec';
  return undefined;
}

export function snippetSupports(kind: FactKind, text: string): boolean {
  switch (kind) {
    case 'levy':
      return LEVY_FACT.test(text);
    case 'spec':
      return SPEC_FACT.test(text);
    case 'quote':
      return QUOTE_FACT.test(text);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** A domain the user wrote, or that a result's title or snippet already writes out. Never guessed from an acronym. */
export function namedSite(query: string, rows: readonly { title?: string; snippet?: string }[]): string | undefined {
  const siteOp = query.match(/\bsite:((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i)?.[1];
  if (siteOp) return siteOp.toLowerCase().replace(/^www\./, '');
  const inQuery = query.match(/\b((?:[a-z0-9-]+\.)+(?:gov|mil|edu|int|com|org|net))\b/i)?.[1];
  if (inQuery) return inQuery.toLowerCase().replace(/^www\./, '');
  for (const row of rows) {
    const written = `${row.title ?? ''} ${row.snippet ?? ''}`.match(/\b((?:[a-z0-9-]+\.)+(?:gov|mil|edu|int|com|org|net))\b/i)?.[1];
    if (written) return written.toLowerCase().replace(/^www\./, '');
  }
  return undefined;
}

/** The single gap-fill query. A comparison stays one question, not one search per side. */
export function gapSearchQuery(question: string, site?: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (!site) return clipChars(clean, 128);
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\bsite:${escaped}\\b`, 'i').test(clean)) return clipChars(clean, 128);
  const op = ` site:${site}`;
  if (op.length + 8 > 128) return clipChars(clean, 128);
  return `${clipChars(clean, 128 - op.length).trimEnd()}${op}`;
}

function subjectTokens(question: string): string[] {
  return question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
}

function namesSubject(row: { title?: string; url?: string }, tokens: readonly string[]): boolean {
  if (!tokens.length) return false;
  const hay = `${row.title ?? ''} ${row.url ?? ''}`.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

/** 0 is a government or school host. Other authority hosts are 1. Everything else is 2. */
function officialRank(domain: string): 0 | 1 | 2 {
  const host = domain.toLowerCase().replace(/^www\./, '');
  if (/\.(?:gov|edu|mil)(?:\.[a-z]{2})?$/.test(host) || /\.state\.[a-z]{2}\.us$/.test(host)) return 0;
  if (hostTier(host) === 0) return 1;
  return 2;
}

type FigureWant = 'money' | 'percent' | 'measure';

function wantFor(kind: FactKind, question: string): FigureWant {
  if (kind === 'spec') return 'measure';
  if (/\b(?:tax|taxes|vat|gst|rate|percent)\b/i.test(question) && !/\b(?:fee|fees|fine|fines|toll|duty|surcharge|levy)\b/i.test(question)) return 'percent';
  return 'money';
}

function figurePattern(want: FigureWant): RegExp {
  if (want === 'money') return new RegExp(MONEY_RE.source, 'g');
  if (want === 'percent') return new RegExp(PERCENT_RE.source, 'gi');
  return new RegExp(MEASURE_RE.source, 'gi');
}

function figureKey(want: FigureWant, raw: string): string {
  if (want === 'money') return String(Number(raw.replace(/[^\d.]/g, '')));
  if (want === 'percent') return `${Number(raw.match(/\d+(?:\.\d+)?/)?.[0] ?? raw)}%`;
  const number = raw.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?/)?.[0]?.replace(/,/g, '') ?? '';
  const unit = raw.match(/[a-z]+/i)?.[0]?.toLowerCase() ?? '';
  return `${number}${unit}`;
}

/** Distinct figures in `text`. $130 and $130.00 are one figure. An add-on and the base charge are not. */
export function figureKeys(kind: FactKind, question: string, text: string): string[] {
  const want = wantFor(kind, question);
  const keys = new Set<string>();
  for (const match of text.matchAll(figurePattern(want))) {
    const key = figureKey(want, match[0]);
    if (key && key !== 'NaN' && !key.startsWith('NaN')) keys.add(key);
  }
  return [...keys];
}

export interface LeadFigure {
  /** The amount as written, without a space after the currency sign. */
  figure: string;
  value: number;
  /** The clause that states this figure, ending at the figure. */
  line: string;
  score: number;
  key: string;
}

function clauseAt(text: string, index: number, length: number): string {
  const breaks = ['\n', '|', '.'].map((mark) => text.lastIndexOf(mark, index - 1));
  const before = Math.max(...breaks);
  const start = before >= 0 && index - before < 180 ? before + 1 : Math.max(0, index - 80);
  return text.slice(start, index + length).replace(/\s+/g, ' ').trim();
}

/**
 * The figure the question is about. A different amount in the same snippet, including an
 * optional add-on, does not win just because it is a number.
 */
export function leadFigure(kind: FactKind, question: string, text: string): LeadFigure | undefined {
  if (kind === 'quote') return undefined;
  const want = wantFor(kind, question);
  const tokens = subjectTokens(question);
  let best: LeadFigure | undefined;
  for (const match of text.matchAll(figurePattern(want))) {
    const at = match.index ?? 0;
    const line = clauseAt(text, at, match[0].length);
    const near = text.slice(Math.max(0, at - 28), at);
    let score = 1;
    const low = line.toLowerCase();
    const close = near.toLowerCase();
    for (const token of tokens) {
      if (low.includes(token)) score += 3;
      if (close.includes(token)) score += 2;
    }
    if (!ADDON.test(question) && ADDON.test(line)) score -= 8;
    if (score < 4) continue;
    if (best && score <= best.score) continue;
    const figure = match[0].replace(/\s/g, '');
    const value = Number(figure.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(value)) continue;
    best = { figure, value, line, score, key: figureKey(want, match[0]) };
  }
  return best;
}

function rowText(row: SearchResult): string {
  return `${row.title ?? ''}\n${row.snippet ?? ''}\n${row.content ?? ''}`;
}

/** One figure, and it is the same figure the question is already pointing at. */
function rowSettled(kind: FactKind, question: string, row: SearchResult, shown: LeadFigure | undefined): boolean {
  const text = rowText(row);
  const keys = figureKeys(kind, question, text);
  if (keys.length !== 1) return false;
  const lead = leadFigure(kind, question, text);
  const key = lead?.key ?? keys[0];
  return !shown || key === shown.key;
}

function thinSnippet(kind: FactKind, row: SearchResult): boolean {
  if (row.content && row.content.length >= 300 && snippetSupports(kind, row.content) && !isBlockPage(row.content)) return false;
  return !snippetSupports(kind, `${row.title} ${row.snippet}`);
}

function citeUrls(kind: FactKind, question: string, rows: readonly SearchResult[]): string[] {
  const usable = rows.slice(0, 8).filter((row) => {
    if (!row.url || !isFetchable(row.url)) return false;
    const domain = row.domain || domainOf(row.url);
    if (isVideoHost(domain) || isSocialHost(domain)) return false;
    return thinSnippet(kind, row);
  });
  if (kind === 'spec') {
    const tokens = subjectTokens(question);
    return usable
      .filter((row) => !ROUNDUP.test(`${row.title} ${row.url}`) && namesSubject(row, tokens))
      .slice(0, FETCH_CAP)
      .map((row) => row.url);
  }
  const ranked = usable
    .map((row) => ({ row, rank: officialRank(row.domain || domainOf(row.url)) }))
    .filter((item) => item.rank < 2)
    .sort((a, b) => a.rank - b.rank);
  const gov = ranked.filter((item) => item.rank === 0);
  const pool = gov.length ? gov : ranked;
  const cap = kind === 'quote' ? 1 : FETCH_CAP;
  return pool.slice(0, cap).map((item) => item.row.url);
}

/** Official pages for a fee or tax, or the subject's own spec page. A roundup is not this. */
function authorityUrls(kind: FactKind, question: string, rows: readonly SearchResult[]): string[] {
  const usable = rows.slice(0, 8).filter((row) => {
    if (!row.url || !isFetchable(row.url)) return false;
    const domain = row.domain || domainOf(row.url);
    return !isVideoHost(domain) && !isSocialHost(domain);
  });
  if (kind === 'spec') {
    const tokens = subjectTokens(question);
    return usable
      .filter((row) => !ROUNDUP.test(`${row.title} ${row.url}`) && namesSubject(row, tokens))
      .slice(0, FETCH_CAP)
      .map((row) => row.url);
  }
  const ranked = usable
    .map((row) => ({ row, rank: officialRank(row.domain || domainOf(row.url)) }))
    .filter((item) => item.rank < 2)
    .sort((a, b) => a.rank - b.rank || subjectTokens(question).filter((token) => `${b.row.title} ${b.row.url}`.toLowerCase().includes(token)).length - subjectTokens(question).filter((token) => `${a.row.title} ${a.row.url}`.toLowerCase().includes(token)).length);
  const gov = ranked.filter((item) => item.rank === 0);
  const pool = gov.length ? gov : ranked;
  const cap = kind === 'quote' ? 1 : FETCH_CAP;
  return pool.slice(0, cap).map((item) => item.row.url);
}

export function thinPlan(question: string, rows: readonly SearchResult[], opts: ThinOpts = {}): ThinPlan {
  const empty: ThinPlan = { fetches: [], search: false };
  if (!rows.length || opts.mode === 'refine' || opts.quote) return empty;
  if (opts.pattern === 'draft' || opts.pattern === 'code') return empty;
  if (rows[0]?.engines.includes('quote')) return empty;
  const kind = factKind(question);
  if (!kind) return empty;
  const kept = rows.slice(0, 12);
  const corpus = kept.map((row) => rowText(row)).join('\n');
  // A quotation is one string. Any other fact is not "already answered" by a stray number.
  if (kind === 'quote') {
    if (snippetSupports(kind, corpus)) return { kind, fetches: [], search: false };
    const fetches = citeUrls(kind, question, rows);
    const search = fetches.length === 0;
    const site = search ? namedSite(question, rows) : undefined;
    return { kind, fetches, search, ...(site ? { site } : {}) };
  }
  const shown = leadFigure(kind, question, corpus);
  const disagree = figureKeys(kind, question, corpus).length > 1;
  const authority = authorityUrls(kind, question, kept);
  const tied = authority.some((url) => {
    const row = kept.find((item) => item.url === url);
    return !!row && rowSettled(kind, question, row, shown);
  });
  // Disagreeing amounts, or a lead that is not the authoritative page's own line, need that page.
  if (authority.length && (disagree || !tied)) return { kind, fetches: authority, search: false };
  const keys = figureKeys(kind, question, corpus);
  if (keys.length === 0 || (disagree && authority.length === 0)) {
    const site = namedSite(question, kept);
    return { kind, fetches: [], search: true, ...(site ? { site } : {}) };
  }
  return { kind, fetches: [], search: false };
}

function factPattern(kind: FactKind): RegExp {
  switch (kind) {
    case 'levy':
      return LEVY_FACT;
    case 'spec':
      return SPEC_FACT;
    case 'quote':
      return QUOTE_FACT;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Keeps the line that states the fact. A different amount on the same page does not come along. */
export function focusFact(kind: FactKind, markdown: string, question = ''): string {
  const raw = markdown.replace(/\r/g, '').trim();
  if (!raw || isBlockPage(raw)) return '';
  if (question && kind !== 'quote') {
    const lead = leadFigure(kind, question, raw);
    if (lead && !isBlockPage(lead.line)) return lead.line.length > 500 ? `${lead.line.slice(0, 500)}…` : lead.line;
  }
  const parts = raw.split(/\n{2,}/);
  const re = factPattern(kind);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!re.test(part)) continue;
    kept.push([parts[i - 1], part, parts[i + 1]].filter(Boolean).join('\n\n'));
    if (kept.join('\n\n').length > 2400) break;
  }
  const text = (kept.length ? kept.join('\n\n') : raw).replace(/\n{3,}/g, '\n\n').trim();
  if (!text || isBlockPage(text)) return '';
  return text.length > 2800 ? `${text.slice(0, 2800)}…` : text;
}

export async function fetchCitePages(env: Env, scope: AskScope, kind: FactKind, urls: readonly string[], timeoutMs = READ_MS, question = ''): Promise<FetchedPage[]> {
  const jobs = urls.slice(0, FETCH_CAP).map(async (url) => {
    try {
      const doc = await deepseekFetch(env, url, scope.ledger, scope.ledger, timeoutMs);
      const text = doc ? focusFact(kind, doc.content, question) : '';
      if (!text || !snippetSupports(kind, text)) return undefined;
      return { url, text };
    } catch (err) {
      console.log(JSON.stringify({ zo: 'deepseek', op: 'fetch', failed: String(err).slice(0, 120) }));
      return undefined;
    }
  });
  const settled = await Promise.all(jobs);
  return settled.filter((page): page is FetchedPage => !!page);
}

export interface GapFill {
  search: SearchResponse;
  shifted?: { after: number; by: number };
  added: boolean;
}

function rowFromHit(hit: DeepSeekHit, content?: string): SearchResult {
  const text = (content || hit.content || hit.summary || '').trim();
  return {
    title: hit.title || domainOf(hit.url),
    url: hit.url,
    snippet: clip(hit.snippet || hit.summary || hit.title, 320),
    domain: domainOf(hit.url),
    engines: ['web'],
    date: hit.date,
    content: text || undefined,
  };
}

/**
 * One Search after Serper, when no kept page is the one to read. `need_content` is set
 * because this call does not Fetch. New rows join the list the card already has. Images stay.
 * A miss returns undefined and the caller keeps the Serper response.
 */
export async function fillFromSearch(
  question: string,
  search: SearchResponse,
  env: Env,
  scope: AskScope,
  kind: FactKind,
  site: string | undefined,
  timeoutMs = READ_MS,
): Promise<GapFill | undefined> {
  const started = Date.now();
  let hits: DeepSeekHit[] | undefined;
  try {
    hits = await deepseekSearch(env, {
      query: gapSearchQuery(question, site),
      oriQuestion: question,
      count: 5,
      needContent: true,
    }, scope.ledger, timeoutMs);
  } catch (err) {
    console.log(JSON.stringify({ zo: 'deepseek', op: 'search', failed: String(err).slice(0, 120) }));
    return undefined;
  }
  if (!hits?.length) return undefined;
  const seen = new Set(search.results.map((row) => normalizeUrl(row.url)));
  const fresh = hits.filter((hit) => hit.url && !seen.has(normalizeUrl(hit.url)) && isFetchable(hit.url));
  const lead = fresh.find((hit) => officialRank(domainOf(hit.url)) === 0)
    ?? fresh.find((hit) => snippetSupports(kind, `${hit.title} ${hit.snippet} ${hit.summary} ${hit.content}`));
  if (!lead) return undefined;
  const focused = lead.content ? focusFact(kind, lead.content) : '';
  const body = focused && snippetSupports(kind, focused)
    ? focused
    : (snippetSupports(kind, lead.summary) ? lead.summary : '');
  if (!body) return undefined;
  const add = rowFromHit(lead, body);
  const quoteLead = search.results[0]?.engines.includes('quote') ? 1 : 0;
  const results = [...search.results.slice(0, quoteLead), add, ...search.results.slice(quoteLead)];
  console.log(JSON.stringify({ zo: 'deepseek', op: 'search', added: domainOf(add.url), ms: Date.now() - started }));
  return {
    search: { ...search, results },
    shifted: { after: quoteLead, by: 1 },
    added: true,
  };
}

export function shiftBrief(brief: SourceBrief, after: number, by: number): SourceBrief {
  if (by <= 0) return brief;
  const move = (n: number) => (n > after ? n + by : n);
  return {
    ...brief,
    use: brief.use.map(move),
    stale: brief.stale.map(move),
    offTopic: brief.offTopic.map(move),
    conflicts: brief.conflicts.map((note) => note.replace(/\[(\d+)\]/g, (_full, n: string) => `[${move(Number(n))}]`)),
  };
}

export function renumberPages(pages: readonly PageText[], after: number, by: number): PageText[] {
  if (by <= 0) return [...pages];
  return pages.map((page) => (page.n > after ? { ...page, n: page.n + by } : page));
}

/** Puts fetched markdown on the matching row and into the page list. Snippets and images stay. */
export function applyFetched(search: SearchResponse, pages: readonly PageText[], fetched: readonly FetchedPage[]): { search: SearchResponse; pages: PageText[] } {
  if (!fetched.length) return { search, pages: [...pages] };
  const byUrl = new Map(fetched.map((page) => [normalizeUrl(page.url), page.text]));
  const results = search.results.map((row) => {
    const text = byUrl.get(normalizeUrl(row.url));
    return text ? { ...row, content: text } : row;
  });
  const pageByN = new Map(pages.map((page) => [page.n, page]));
  results.forEach((row, index) => {
    const text = byUrl.get(normalizeUrl(row.url));
    if (!text) return;
    const prior = pageByN.get(index + 1);
    pageByN.set(index + 1, { n: index + 1, url: row.url, text, image: prior?.image });
  });
  return {
    search: { ...search, results },
    pages: [...pageByN.values()].sort((a, b) => a.n - b.n),
  };
}

/** Page text already stored on a row the collector did not read, so the designer still sees it. */
export function pagesFromContent(results: readonly SearchResult[], pages: readonly PageText[]): PageText[] {
  const have = new Set(pages.map((page) => page.n));
  const extra: PageText[] = [];
  results.slice(0, 12).forEach((row, index) => {
    const n = index + 1;
    if (have.has(n) || !row.content || isBlockPage(row.content)) return;
    extra.push({ n, url: row.url, text: row.content.slice(0, 6000) });
  });
  return [...pages, ...extra].sort((a, b) => a.n - b.n);
}
