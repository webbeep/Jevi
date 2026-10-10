import type { SearchResult } from '../shared/types';
import { firstNameForms } from './entity';
import { readPage } from './htmlcap';
import { BROWSER_UA, htmlToText, isFetchable } from './pages';
import { domainOf } from './util';

/** Sites that host many people's pages: a profile there is never the person's own website. */
const HUBS = new Set([
  'linkedin', 'facebook', 'instagram', 'twitter', 'x', 'threads', 'bsky', 'tiktok', 'youtube', 'pinterest', 'reddit', 'quora',
  'medium', 'substack', 'imdb', 'wikipedia', 'wikidata', 'researchgate', 'academia', 'github', 'gitlab', 'orcid', 'dblp',
  'openreview', 'semanticscholar', 'alphaxiv', 'arxiv', 'google', 'crunchbase', 'zoominfo', 'rocketreach', 'whitepages',
  'spokeo', 'bloomberg', 'forbes', 'apple', 'amazon', 'spotify', 'soundcloud', 'about', 'linktr', 'muckrack',
]);
/** Second-level labels under a country code ("example.co.uk"). */
const SLD = new Set(['co', 'com', 'ac', 'org', 'net', 'edu', 'gov']);
const PERSONAL_HOST = /\.(github|gitlab)\.io$|\.netlify\.app$|\.vercel\.app$/;

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function nameParts(name: string): { firsts: string[]; last: string } | undefined {
  const words = name.toLowerCase().split(/\s+/).map(letters).filter((w) => w.length > 1);
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || words.length < 2 || last.length < 3) return undefined;
  return { firsts: [...new Set([first, ...firstNameForms(first)])], last };
}

/** The name a site is registered under: "jesshamrick" for www.jesshamrick.com or jesshamrick.co.uk. */
function siteLabel(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  const at = parts.length >= 3 && SLD.has(parts.at(-2)!) ? parts.length - 3 : parts.length - 2;
  return parts[Math.max(0, at)] ?? '';
}

function nameLabels(firsts: string[], last: string): Set<string> {
  return new Set(firsts.flatMap((f) => [`${f}${last}`, `${last}${f}`, `${f[0]}${last}`]));
}

/**
 * The person's own website: a domain registered under their name (jesshamrick.com), a personal page host
 * (name.github.io, sites.google.com/view/name) or a university home directory (~jhamrick).
 */
export function isOwnSite(name: string, row: Pick<SearchResult, 'url' | 'title' | 'snippet'>): boolean {
  const parts = nameParts(name);
  if (!parts) return false;
  let url: URL;
  try {
    url = new URL(row.url);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const { firsts, last } = parts;
  if (!`${row.title} ${row.snippet}`.toLowerCase().includes(last)) return false;
  if (PERSONAL_HOST.test(host)) return letters(host.split('.')[0]!).includes(last);
  if (host === 'sites.google.com') return letters(url.pathname.split('/').slice(0, 4).join('')).includes(last);
  const home = url.pathname.match(/^\/~([^/]+)/)?.[1];
  if (home) return letters(home).includes(last);
  if (host.split('.').some((label) => HUBS.has(label))) return false;
  return nameLabels(firsts, last).has(siteLabel(host));
}

export interface SiteCandidate {
  url: string;
  title: string;
  description: string;
  text: string;
}

const GUESSES = 3;
const PROBE_MS = 1500;

/** Domains a person's own website is most often registered under, most likely first. */
export function siteGuesses(name: string): string[] {
  const parts = nameParts(name);
  if (!parts) return [];
  const [first, ...nicks] = parts.firsts;
  const short = nicks.filter((n) => n.length < first!.length).sort((a, b) => a.length - b.length);
  return [...new Set([`${first}${parts.last}.com`, ...short.slice(0, 1).map((n) => `${n}${parts.last}.com`), `${first![0]}${parts.last}.com`])]
    .slice(0, GUESSES)
    .map((d) => `https://${d}/`);
}

async function fetchSite(url: string): Promise<SiteCandidate | undefined> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal: AbortSignal.timeout(PROBE_MS), redirect: 'follow' });
    const final = res.url || url;
    if (!res.ok || !res.headers.get('content-type')?.includes('html') || !isFetchable(final)) return undefined;
    const { head, body } = await readPage(res, 60_000);
    const top = head || body.slice(0, 20_000);
    const title = top.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '';
    const description = top.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ?? '';
    return { url: final, title, description, text: htmlToText(body).slice(0, 6000) };
  } catch {
    return undefined;
  }
}

/**
 * Fetches the guessed domains in parallel. Free (no search API) and bounded: at most three
 * subrequests of 1.5 s each, started with the search so the wait is already over when the card is laid out.
 */
export async function probeOwnSite(name: string): Promise<SiteCandidate[]> {
  const found = await Promise.all(siteGuesses(name).map(fetchSite));
  return found.filter((c): c is SiteCandidate => !!c);
}

/**
 * The candidate that is this person's site: its title names them and its text says something the
 * search results also say about them (employer, field, place). A namesake's site matches the name only.
 */
export function pickOwnSite(candidates: SiteCandidate[], name: string, terms: string[]): SearchResult | undefined {
  const parts = nameParts(name);
  const wanted = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3))];
  if (!parts || !wanted.length) return undefined;
  for (const c of candidates) {
    const title = c.title.toLowerCase();
    if (!title.includes(parts.last) || !parts.firsts.some((f) => title.includes(f))) continue;
    const text = `${c.title} ${c.description} ${c.text}`.toLowerCase();
    if (!wanted.some((t) => text.includes(t))) continue;
    const snippet = (c.description || c.text).replace(/\s+/g, ' ').slice(0, 320);
    return { title: c.title, url: c.url, snippet, domain: domainOf(c.url), engines: ['site'], content: c.text.length >= 300 ? c.text : undefined };
  }
  return undefined;
}

const ORCID = 'https://pub.orcid.org/v3.0';
const ORCID_MS = 1500;

interface OrcidHit {
  'orcid-id'?: string;
  'given-names'?: string;
  'family-names'?: string;
  'credit-name'?: string | null;
  'institution-name'?: string[];
}

/** Researchers' asks: "research scientist", "professor", a lab or a PhD. */
export const RESEARCH_ASK = /\b(research(er)?|scientist|professor|prof|phd|postdoc|lab|universit(y|ies)|lecturer|academic|scholar|faculty)\b/i;

async function orcidJson<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(`${ORCID}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ORCID_MS) });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The ORCID record of this person: their name, at an institution the results also name. */
export function pickOrcid(hits: OrcidHit[], name: string, terms: string[]): OrcidHit | undefined {
  const parts = nameParts(name);
  const wanted = terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  if (!parts || !wanted.length) return undefined;
  return hits.find((h) => letters(h['family-names'] ?? '') === parts.last
    && parts.firsts.includes(letters((h['given-names'] ?? '').split(/\s+/)[0] ?? ''))
    && (h['institution-name'] ?? []).some((inst) => wanted.some((t) => inst.toLowerCase().includes(t))));
}

/**
 * A researcher's website as they list it on their own ORCID record (keyless, two small calls).
 * Their homepage on a scholar profile is what search engines miss, and the profile pages themselves
 * refuse datacenter fetches; ORCID's public API does not.
 */
export async function orcidSite(name: string, terms: string[]): Promise<SearchResult | undefined> {
  const parts = nameParts(name);
  if (!parts) return undefined;
  const q = encodeURIComponent(`given-names:${parts.firsts[0]} AND family-name:${parts.last}`);
  const found = await orcidJson<{ 'expanded-result'?: OrcidHit[] | null }>(`/expanded-search/?q=${q}&rows=10`);
  const hit = pickOrcid(found?.['expanded-result'] ?? [], name, terms);
  const id = hit?.['orcid-id'];
  if (!id || !/^[\d-]{15,}X?$/.test(id)) return undefined;
  const urls = await orcidJson<{ 'researcher-url'?: { url?: { value?: string } }[] }>(`/${id}/researcher-urls`);
  const url = (urls?.['researcher-url'] ?? []).map((u) => u.url?.value ?? '').find((u) => {
    if (!isFetchable(u)) return false;
    const host = new URL(u).hostname.toLowerCase();
    return host === 'sites.google.com' || !host.split('.').some((label) => HUBS.has(label));
  });
  if (!url) return undefined;
  const who = hit['credit-name'] || name;
  const where = (hit['institution-name'] ?? []).slice(0, 3).join(', ');
  return { title: `${who} — personal website`, url, snippet: `${who}'s own website, as listed on their ORCID profile${where ? ` (${where})` : ''}.`, domain: domainOf(url), engines: ['orcid'] };
}

/** Moves the person's own website right after the lead row, where the designer and the reader see it. */
export function withOwnSite(rows: SearchResult[], site: SearchResult): { rows: SearchResult[]; n: number } {
  const rest = rows.filter((r) => r.url !== site.url);
  const at = rows[0]?.url === site.url ? 0 : Math.min(1, rest.length);
  const out = [...rest.slice(0, at), site, ...rest.slice(at)];
  return { rows: out, n: at + 1 };
}
