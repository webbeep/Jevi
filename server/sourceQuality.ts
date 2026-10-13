/**
 * Puts trustworthy, same-language sources first and keeps the card in the language of the question.
 * Deterministic: no network and no model call. A list is never emptied.
 */
import type { CardNode } from '../shared/card';
import { shoppingAsk } from './claims';
import { PAPER_ASK } from './scholarly';

const AUTHORITY = [
  'wikipedia.org', 'britannica.com', 'nobelprize.org', 'medlineplus.gov', 'nih.gov', 'cdc.gov', 'who.int',
  'nasa.gov', 'nature.com', 'science.org', 'scientificamerican.com', 'mayoclinic.org', 'nba.com', 'espn.com',
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'washingtonpost.com',
];

const PRESS = [
  'cnet.com', 'techradar.com', 'theverge.com', 'tomsguide.com', 'gsmarena.com', 'phonearena.com',
  'androidauthority.com', 'androidcentral.com', 'pcmag.com', 'mashable.com', 'wired.com', 'arstechnica.com',
  'cbssports.com', 'sports.yahoo.com', 'yahoo.com', 'basketball-reference.com', 'foxchase.org', 'sciencefocus.com',
  'pearson.com', 'nobelprize.org',
];

/** Classroom blogs, slideshows, and free-host pages that outranked the encyclopedia. */
const WEAK = [
  'blogspot.com', 'wordpress.com', 'sites.google.com', 'wixsite.com', 'weebly.com', 'tumblr.com',
  'genially.com', 'livejournal.com', 'blogger.com',
];

/** Forums and social posts. They stay when nothing else answered. */
const SOCIAL = ['reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'x.com', 'twitter.com', 'quora.com'];

/** A paper, preprint, or journal. News and video rank behind these on a research question. */
const SCHOLAR = [
  'doi.org', 'arxiv.org', 'ncbi.nlm.nih.gov', 'nature.com', 'science.org', 'sciencedirect.com',
  'springer.com', 'wiley.com', 'cell.com', 'thelancet.com', 'nejm.org', 'pnas.org', 'plos.org',
  'frontiersin.org', 'mdpi.com', 'biorxiv.org', 'medrxiv.org', 'semanticscholar.org', 'jstor.org',
  'acm.org', 'ieee.org',
];

const EN = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'in', 'was', 'were', 'for', 'with', 'her', 'his', 'she', 'he', 'from', 'that', 'who', 'on', 'as', 'by', 'is', 'are', 'its', 'their', 'this', 'be', 'or', 'at', 'it', 'not']);
const ROMANCE = new Set(['el', 'la', 'los', 'las', 'una', 'un', 'del', 'que', 'por', 'sus', 'para', 'donde', 'fue', 'era', 'en', 'se', 'de', 'al', 'su', 'como', 'también', 'tambien', 'con', 'esta', 'este', 'pero', 'porque', 'cuando', 'sobre', 'entre', 'desde', 'hasta']);

const KEEP = 4;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function endsWithHost(domain: string, host: string): boolean {
  return domain === host || domain.endsWith(`.${host}`);
}

function domainOf(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function matchesHost(domain: string, hosts: readonly string[]): boolean {
  const d = domainOf(domain);
  return hosts.some((host) => d === host || d.endsWith(`.${host}`));
}

export function isSocialHost(domain: string): boolean {
  return matchesHost(domain, SOCIAL);
}

export function isScholarHost(domain: string): boolean {
  return matchesHost(domain, SCHOLAR);
}

export function isVideoHost(domain: string): boolean {
  const d = domainOf(domain);
  return d === 'youtube.com' || d === 'youtu.be' || d.endsWith('.youtube.com');
}

/** 0 is an encyclopedia or official page, 3 is a free-host blog. */
export function hostTier(domain: string): 0 | 1 | 2 | 3 {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (!d) return 2;
  if (AUTHORITY.some((host) => endsWithHost(d, host)) || /\.(?:gov|edu|mil)(?:\.[a-z]{2})?$/.test(d)) return 0;
  if (PRESS.some((host) => endsWithHost(d, host))) return 1;
  if (WEAK.some((host) => endsWithHost(d, host))) return 3;
  return 2;
}

/** True when the question is written in Latin letters, so an English answer is the right one. */
export function latinQuery(query: string): boolean {
  const letters = [...query].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length < 3) return true;
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length >= 0.8;
}

function cjkShare(text: string): number {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length < 6) return 0;
  const cjk = letters.filter((ch) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(ch)).length;
  return cjk / letters.length;
}

function romanceHeavy(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-záéíóúñü]+/).filter((word) => word.length > 1);
  if (words.length < 8) return false;
  let en = 0;
  let other = 0;
  for (const word of words) {
    if (EN.has(word)) en += 1;
    if (ROMANCE.has(word)) other += 1;
  }
  return other >= 4 && other > en;
}

function foreignText(text: string): boolean {
  return cjkShare(text) >= 0.25 || romanceHeavy(text);
}

export interface RankedHit {
  url: string;
  title: string;
  snippet?: string;
  domain: string;
  date?: string;
}

const LEAGUE = new Set(['nba', 'nfl', 'mlb', 'nhl', 'ncaa', 'wnba', 'mls', 'ufc', 'pga', 'wwe']);
const STATES = 'alabama:al,alaska:ak,arizona:az,arkansas:ar,california:ca,colorado:co,connecticut:ct,delaware:de,florida:fl,georgia:ga,hawaii:hi,idaho:id,illinois:il,indiana:in,iowa:ia,kansas:ks,kentucky:ky,louisiana:la,maine:me,maryland:md,massachusetts:ma,michigan:mi,minnesota:mn,mississippi:ms,missouri:mo,montana:mt,nebraska:ne,nevada:nv,new hampshire:nh,new jersey:nj,new mexico:nm,new york:ny,north carolina:nc,north dakota:nd,ohio:oh,oklahoma:ok,oregon:or,pennsylvania:pa,rhode island:ri,south carolina:sc,south dakota:sd,tennessee:tn,texas:tx,utah:ut,vermont:vt,virginia:va,washington:wa,west virginia:wv,wisconsin:wi,wyoming:wy';
const OFFICIAL_ASK = /\b(how many|population|tax|taxes|law|laws|legal|illegal|ban|banned|regulation|statute|official|census)\b/i;

function orgTokens(query: string): string[] {
  return [...query.matchAll(/\b[A-Z]{3,8}\b/g)].map((match) => match[0].toLowerCase()).filter((word) => !LEAGUE.has(word) && word !== 'doi' && word !== 'pdf' && word !== 'url');
}

function placeHosts(query: string): string[] {
  if (!OFFICIAL_ASK.test(query)) return [];
  let rest = ` ${query.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const hosts: string[] = [];
  const names = STATES.split(',').map((pair) => {
    const [name, code] = pair.split(':');
    return [name!, code!] as const;
  }).sort((a, b) => b[0].length - a[0].length);
  for (const [name, code] of names) {
    const needle = ` ${name} `;
    if (!rest.includes(needle)) continue;
    rest = rest.replaceAll(needle, ' ');
    hosts.push(`.${code}.us`, `${code}.gov`);
  }
  return hosts;
}

function yearOf(row: RankedHit): number {
  const dated = row.date?.match(/\b(?:19|20)\d{2}\b/);
  if (dated) return Number(dated[0]);
  const years = row.title.match(/\b(?:19|20)\d{2}\b/g);
  if (!years?.length) return 0;
  return Math.max(...years.map(Number));
}

/** 0 when the question names this host (IPCC → ipcc.ch) or the place's own official site. */
function officialLead(domain: string, orgs: readonly string[], places: readonly string[]): number {
  const host = domainOf(domain);
  if (orgs.some((token) => host.includes(token))) return 0;
  if (places.some((suffix) => host.endsWith(suffix) || host.includes(suffix.replace(/^\./, '')))) return 0;
  return 1;
}

/**
 * Drops foreign-script hits and free-host blogs once enough better hits remain, then
 * orders encyclopedias and official sites ahead of everything else. Same objects, new order.
 */
export function preferSources<T extends RankedHit>(query: string, rows: readonly T[]): T[] {
  if (rows.length <= 1) return [...rows];
  const latin = latinQuery(query);
  const marked = rows.map((row, index) => ({
    row,
    index,
    tier: hostTier(row.domain || hostOf(row.url)),
    foreign: latin && cjkShare(`${row.title} ${row.snippet ?? ''}`) >= 0.3,
  }));
  let pool = marked;
  const native = pool.filter((item) => !item.foreign);
  if (native.length >= KEEP) pool = native;
  const solid = pool.filter((item) => item.tier < 3);
  if (solid.length >= KEEP) pool = solid;
  // A shopping ask keeps forum posts: the product photo and the price are often there.
  // Other asks drop those posts once enough pages remain, so a thread does not lead.
  if (!shoppingAsk(query)) {
    const nonsocial = pool.filter((item) => !isSocialHost(item.row.domain || hostOf(item.row.url)));
    if (nonsocial.length >= KEEP) pool = nonsocial;
  }
  // A person or a scoreboard should lead with the encyclopedia or the league. A research
  // question leads with papers and official pages. Other asks keep the engine's order, with
  // free-host pages that had to stay sunk to the back.
  const promote = /\b(who|whom|whose|biography|nobel|scores?|scoreboard|standings)\b/i.test(query);
  const orgs = orgTokens(query);
  const places = placeHosts(query);
  const leadOf = (item: (typeof pool)[number]) => officialLead(item.row.domain || hostOf(item.row.url), orgs, places);
  const byLead = (a: (typeof pool)[number], b: (typeof pool)[number]) => {
    const lead = leadOf(a) - leadOf(b);
    if (lead) return lead;
    if (leadOf(a) === 0) {
      const ay = yearOf(a.row);
      const by = yearOf(b.row);
      if (ay && by && ay !== by) return by - ay;
      // A title that names an old year is a press release. The undated page on that host is the current one.
      const stale = (year: number) => year > 0 && year < 2022;
      if (stale(ay) && !by) return 1;
      if (!ay && stale(by)) return -1;
    }
    return 0;
  };
  if (PAPER_ASK.test(query)) {
    const rank = (item: (typeof pool)[number]) => {
      const domain = item.row.domain || hostOf(item.row.url);
      if (isVideoHost(domain) || isSocialHost(domain)) return 3;
      if (isScholarHost(domain) || item.tier === 0) return 0;
      return 1;
    };
    if (pool.some((item) => rank(item) === 0)) pool.sort((a, b) => byLead(a, b) || rank(a) - rank(b) || a.index - b.index);
    else pool.sort((a, b) => byLead(a, b) || Number(a.tier === 3) - Number(b.tier === 3) || a.index - b.index);
  } else {
    pool.sort((a, b) => byLead(a, b) || (promote ? a.tier - b.tier : Number(a.tier === 3) - Number(b.tier === 3)) || a.index - b.index);
  }
  return pool.map((item) => item.row);
}

function keepSentences(query: string, text: string): string {
  if (!latinQuery(query)) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((part) => part.trim() && !foreignText(part));
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanText(query: string, text: string | undefined): string | undefined {
  if (!text) return text;
  const next = keepSentences(query, text);
  return next || undefined;
}

/** Drops sentences the question did not ask for, and repeated table or list rows. */
export function cleanNode(query: string, node: CardNode): CardNode | undefined {
  switch (node.type) {
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft': {
      const text = cleanText(query, node.text);
      if (!text) return undefined;
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const caption = cleanText(query, node.caption);
      return caption === node.caption ? node : { ...node, caption };
    }
    case 'heading': {
      const text = cleanText(query, node.text);
      if (!text) return undefined;
      return text === node.text ? node : { ...node, text };
    }
    case 'list': {
      const seen = new Set<string>();
      const items = node.items.flatMap((item) => {
        const text = cleanText(query, item.text);
        if (!text) return [];
        const key = text.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return [];
        seen.add(key);
        return [text === item.text ? item : { ...item, text }];
      });
      if (!items.length) return undefined;
      return items.length === node.items.length && items.every((item, i) => item === node.items[i]) ? node : { ...node, items };
    }
    case 'table': {
      const seen = new Set<string>();
      const rows = node.rows.flatMap((row) => {
        const cells = row.map((cell) => cleanText(query, cell) ?? (foreignText(cell) ? '' : cell));
        if (cells.every((cell) => !cell.trim())) return [];
        const key = cells.join(' | ').toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return [];
        seen.add(key);
        return [cells];
      });
      if (!rows.length) return undefined;
      return rows.length === node.rows.length && rows.every((row, i) => row.every((cell, j) => cell === node.rows[i]?.[j])) ? node : { ...node, rows };
    }
    case 'tile': {
      const sub = cleanText(query, node.sub);
      return sub === node.sub ? node : { ...node, sub };
    }
    case 'steps': {
      const items = node.items.map((step, index) => {
        const detail = cleanText(query, step.detail);
        const title = /^\d+\.\s/.test(step.title) ? step.title.replace(/^\d+\.\s*/, `${index + 1}. `) : step.title;
        return detail === step.detail && title === step.title ? step : { ...step, title, detail };
      });
      return items.every((step, i) => step === node.items[i]) ? node : { ...node, items };
    }
    case 'accordion': {
      const items = node.items.flatMap((item) => {
        const text = cleanText(query, item.text);
        return text ? [text === item.text ? item : { ...item, text }] : [];
      });
      if (!items.length) return undefined;
      return { ...node, items };
    }
    case 'stack':
    case 'grid':
    case 'scroller':
    case 'section': {
      const children = node.children.flatMap((child) => {
        const next = cleanNode(query, child);
        return next ? [next] : [];
      });
      if (!children.length) return undefined;
      return children.length === node.children.length && children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
    }
    case 'tabs': {
      const tabs = node.tabs
        .map((tab) => ({
          ...tab,
          children: tab.children.flatMap((child) => {
            const next = cleanNode(query, child);
            return next ? [next] : [];
          }),
        }))
        .filter((tab) => tab.children.length);
      if (!tabs.length) return undefined;
      return { ...node, tabs };
    }
    case 'keyvalue':
    case 'timeline':
    case 'stat':
    case 'links':
    case 'video':
    case 'chart':
    case 'ticker':
    case 'progress':
    case 'rating':
    case 'proscons':
    case 'badges':
    case 'code':
    case 'image':
    case 'gallery':
    case 'profile':
    case 'actions':
    case 'choices':
    case 'slider':
    case 'scaler':
    case 'pricing':
    case 'reveal':
    case 'diagram':
    case 'citations':
    case 'divider':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function yearsIn(text: string): string[] {
  return [...text.matchAll(/\b(?:1[5-9]\d{2}|20\d{2})\b/g)].map((match) => match[0]);
}

/**
 * A "sources disagree" note that names two years, when the rest of the card already
 * states one of them and not the other, is the weak page arguing with the encyclopedia.
 */
export function withoutSettledDisputes(nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  const committed = nodes.filter((node) => node && node.type !== 'callout').map((node) => JSON.stringify(node)).join('\n');
  return nodes.map((node) => {
    if (!node || node.type !== 'callout' || !/disagree/i.test(node.text)) return node;
    const years = [...new Set(yearsIn(node.text))];
    if (years.length < 2) return node;
    const shown = years.filter((year) => new RegExp(`\\b${year}\\b`).test(committed));
    return shown.length && shown.length < years.length ? undefined : node;
  });
}

/** Language, repeated rows, and a disagreement the card has already settled. Holes stay holes. */
export function finishQuality(query: string, nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  const cleaned = nodes.map((node) => (node ? cleanNode(query, node) : node));
  return withoutSettledDisputes(cleaned);
}
