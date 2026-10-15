import type { CardNode } from '../shared/card';

/**
 * A question whose answer needs more than one fact: the birth date and the event,
 * the anchor date and what happened a set number of years later, both lengths in a
 * ratio, the newest season's score, or the year an event happened.
 * The extra searches name those facts. They never name a particular person, show, or place.
 */

export interface FactAnswer {
  /** The figure the card should lead with: an age, a rounded quotient, a year, a score, a century. */
  lead: string;
  /** Short hero label for that figure. */
  label: string;
  /** Why that figure, in words the designer can cite from the sources. */
  note: string;
}

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'and', 'or', 'when', 'that', 'this', 'was', 'were', 'got', 'did', 'does', 'after', 'before', 'exactly', 'originally', 'current', 'name', 'day', 'year', 'years']);

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};
const MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const FULL_DATE = new RegExp(
  `\\b(?:(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:1[6-9]|20)\\d{2})|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?\\s+((?:1[6-9]|20)\\d{2}))\\b`,
  'gi',
);
const YEAR = /\b(1[6-9]\d{2}|20\d{2})\b/g;

const AGE = /^how old was (.+?) when (.+?)\??$/i;
const OFFSET = /^what (.+?) opened exactly (\d+) years after (.+?)\??$/i;
const BORN_IN = /\bthe year (.+?) was born\b/i;
const IF_ON = /\bif (.+?) (?:took place|were held|was held|happened|ran) on (.+?)(?:,| how many)/i;
const WHAT_YEAR = /^what year did (.+?)\??$/i;
const SCORE = /\b(?:tomatometer|rotten tomatoes|metacritic)\b/i;
const NEWEST = /\b(?:most recent|latest|current|this season)\b/i;
const VERBS: { ask: RegExp; near: RegExp }[] = [
  { ask: /\bsell\b/i, near: /\b(?:sell|sold|sale|selling)\b/i },
  { ask: /\b(?:found|founded)\b/i, near: /\b(?:found|founded|founding)\b/i },
  { ask: /\bopen(?:ed)?\b/i, near: /\b(?:open|opened|opening)\b/i },
  { ask: /\b(?:die|died)\b/i, near: /\b(?:die|died|death)\b/i },
  { ask: /\b(?:win|won)\b/i, near: /\b(?:win|won|winning)\b/i },
  { ask: /\b(?:leave|left)\b/i, near: /\b(?:leave|left)\b/i },
  { ask: /\b(?:marry|married)\b/i, near: /\b(?:marry|married|marriage|wedding)\b/i },
  { ask: /\b(?:publish|published)\b/i, near: /\b(?:publish|published)\b/i },
  { ask: /\b(?:release|released)\b/i, near: /\b(?:release|released)\b/i },
  { ask: /\bborn\b/i, near: /\bborn\b/i },
];

const clean = (s: string) => s.replace(/[?.]+$/g, '').replace(/\s+/g, ' ').trim();

interface When {
  year: number;
  month: number;
  day: number;
  at: number;
  raw: string;
}

function datesIn(text: string): When[] {
  const out: When[] = [];
  for (const match of text.matchAll(FULL_DATE)) {
    const monthName = (match[1] ?? match[5] ?? '').toLowerCase();
    const month = MONTHS[monthName];
    const day = Number(match[2] ?? match[4]);
    const year = Number(match[3] ?? match[6]);
    if (month === undefined || !day || !year) continue;
    out.push({ year, month, day, at: match.index ?? 0, raw: match[0] });
  }
  return out;
}

function ageAt(birth: When, event: When): number {
  let age = event.year - birth.year;
  if (event.month < birth.month || (event.month === birth.month && event.day < birth.day)) age -= 1;
  return age;
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
}

function windowHas(text: string, at: number, span: number, re: RegExp): boolean {
  return re.test(text.slice(Math.max(0, at - span), at + span));
}

function yearNear(text: string, re: RegExp): string | undefined {
  let best: { year: string; dist: number } | undefined;
  for (const match of text.matchAll(YEAR)) {
    const at = match.index ?? 0;
    const slice = text.slice(Math.max(0, at - 90), at + 20);
    const verbAt = slice.search(re);
    if (verbAt < 0) continue;
    const dist = Math.abs(verbAt - Math.min(90, at));
    if (!best || dist < best.dist) best = { year: match[1]!, dist };
  }
  return best?.year;
}

function eventVerb(query: string): RegExp | undefined {
  return VERBS.find((verb) => verb.ask.test(query))?.near;
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The subject's own birth, the date next to their full name. A relative who shares the surname does not count. */
function birthOf(text: string, who: string): When | undefined {
  const parts = who.split(/\s+/).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, '')).filter((word) => word.length >= 2);
  const first = parts[0];
  const last = parts.at(-1);
  if (!first || !last) return undefined;
  const pair = new RegExp(`\\b${escapeReg(first)}\\s+${escapeReg(last)}\\b`, 'gi');
  let best: { date: When; dist: number } | undefined;
  for (const match of text.matchAll(pair)) {
    const at = match.index ?? 0;
    for (const date of datesIn(text)) {
      const dist = Math.abs(date.at - at);
      if (dist > 80) continue;
      const between = text.slice(Math.min(at, date.at), Math.max(at + match[0].length, date.at + date.raw.length));
      // A period between the name and the date is the next sentence, usually someone else's birth.
      if (/[.!?]/.test(between.replace(/\d\.\d/g, ''))) continue;
      if (!/\bborn\b/i.test(between)) continue;
      if (!best || dist < best.dist) best = { date, dist };
    }
  }
  return best?.date;
}

function eventDate(text: string, event: string, birth?: When): When | undefined {
  const words = tokens(event);
  const verb = /\b(?:married|wedding|marriage|opened|died|won|born)\b/i;
  const scored = datesIn(text)
    .filter((date) => !(birth && date.year === birth.year && date.month === birth.month && date.day === birth.day))
    .map((date) => {
      const slice = text.slice(Math.max(0, date.at - 120), date.at + 40).toLowerCase();
      const verbHit = verb.test(slice) ? 2 : 0;
      const shared = words.filter((word) => slice.includes(word)).length;
      return { date, score: verbHit + shared };
    })
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score || a.date.year - b.date.year || a.date.month - b.date.month);
  return scored[0]?.date;
}

function showTitle(query: string): string {
  const ofSeason = query.match(/\bseason of\s+(.+?)(?:\s+on\s+|\?|$)/i);
  if (ofSeason) return clean(ofSeason[1]!);
  return clean(query.replace(/\b(?:what(?:'s| is)|current|tomatometer|score|most|recent|latest|season|rotten|tomatoes|metacritic)\b/gi, ' '));
}

function seasonScores(text: string): { season: number; score: string }[] {
  const out: { season: number; score: string }[] = [];
  const re = /season\s+(\d+)[^\d%]{0,50}(\d{1,3})\s*%|(\d{1,3})\s*%[^\d]{0,50}season\s+(\d+)/gi;
  for (const match of text.matchAll(re)) {
    const season = Number(match[1] ?? match[4]);
    const score = match[2] ?? match[3];
    if (season && score) out.push({ season, score: `${score}%` });
  }
  return out;
}

function lengths(text: string): { n: number; unit: 'mi' | 'km'; at: number; raw: string }[] {
  const out: { n: number; unit: 'mi' | 'km'; at: number; raw: string }[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(miles|mile|mi|km|kilometers|kilometres)\b/gi;
  for (const match of text.matchAll(re)) {
    const unit = /km|kilometer/i.test(match[2]!) ? 'km' : 'mi';
    out.push({ n: Number(match[1]), unit, at: match.index ?? 0, raw: match[0] });
  }
  return out;
}

/** How far back the nearest whole-word mention sits. Infinity when the word never precedes the measurement. */
function preceding(text: string, at: number, words: string[]): number {
  const before = text.slice(0, at).toLowerCase();
  let best = Infinity;
  for (const word of words) {
    const re = new RegExp(`\\b${word}\\b`, 'g');
    for (const match of before.matchAll(re)) best = Math.min(best, at - (match.index ?? 0));
  }
  return best;
}

function miles(row: { n: number; unit: 'mi' | 'km' }): number {
  return row.unit === 'km' ? row.n / 1.60934 : row.n;
}

function centuryOf(year: number): string {
  const n = Math.ceil(year / 100);
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `the ${n}${suffix} century`;
}

/** Capitalized words that are ordinary English, not the proper name a page just introduced. */
const ORDINARY = new Set([
  'dutch', 'french', 'german', 'english', 'spanish', 'italian', 'japanese', 'chinese', 'american', 'british',
  'russian', 'indian', 'korean', 'swedish', 'norwegian', 'danish', 'belgian', 'swiss', 'austrian', 'irish',
  'scottish', 'welsh', 'polish', 'greek', 'turkish', 'mexican', 'canadian', 'australian', 'african', 'asian',
  'european', 'latin', 'royal', 'great', 'north', 'south', 'east', 'west', 'medieval', 'current', 'original',
  'official', 'according', 'however', 'national', 'international', 'annual', 'modern', 'ancient', 'united',
  'states', 'kingdom', 'republic', 'people', 'world', 'history', 'today', 'retrieved', 'archive', 'wikipedia',
]);

function novelName(query: string, corpus: string): string | undefined {
  const asked = query.toLowerCase();
  const counts = new Map<string, number>();
  for (const match of corpus.matchAll(/\b[A-Z][a-zA-Z]{4,}(?:\s+[A-Z][a-z]+){0,2}\b/g)) {
    const name = match[0];
    const parts = name.split(/\s+/);
    if (asked.includes(name.toLowerCase())) continue;
    if (parts.every((part) => ORDINARY.has(part.toLowerCase()))) continue;
    if (/^(January|February|March|April|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
}

/** Searches that find the facts this question needs, run beside the literal search. */
export function hopQueries(query: string): string[] {
  const age = query.match(AGE);
  if (age) return [`${clean(age[1]!)} date of birth`, `${clean(age[2]!)} date`];
  const offset = query.match(OFFSET);
  if (offset) {
    const place = query.match(/\bin ([A-Z][^?]+?) opened exactly/i);
    return [place ? `${clean(place[1]!)} opening date` : `when ${clean(offset[3]!)}`];
  }
  const born = query.match(BORN_IN);
  if (born && query.length > born[0].length + 8) return [`${clean(born[1]!)} birth year`];
  const placed = query.match(IF_ON);
  if (placed) return [`${clean(placed[1]!)} distance`, `${clean(placed[2]!)} length`];
  if (SCORE.test(query) && NEWEST.test(query)) {
    const title = showTitle(query);
    return title ? [`${title} rotten tomatoes tomatometer`] : [];
  }
  return [];
}

export interface HopContext {
  hosts?: string[];
  asked?: string[];
}

/**
 * The next search, once the pages in hand still lack a fact the question needs.
 * Undefined when the facts are already there, or the next search was already run.
 */
export function nextHop(query: string, corpus: string, ctx: HopContext = {}): string | undefined {
  const seen = new Set((ctx.asked ?? []).map((q) => q.toLowerCase()));
  const candidates: string[] = [];
  const offer = (q: string) => {
    const text = clean(q).slice(0, 160);
    if (text.length < 8 || seen.has(text.toLowerCase()) || text.toLowerCase() === clean(query).toLowerCase()) return;
    candidates.push(text);
  };

  const yearAsk = query.match(WHAT_YEAR);
  if (yearAsk) {
    const verb = eventVerb(yearAsk[1]!);
    if (verb && !yearNear(corpus, verb)) {
      const host = (ctx.hosts ?? []).find((item) => item && !/rotten|youtube/i.test(item));
      const site = host ? ` -site:${host.replace(/^www\./, '')}` : '';
      offer(`${clean(yearAsk[1]!)} year${site}`);
    }
  }

  if (SCORE.test(query) && NEWEST.test(query)) {
    const title = showTitle(query);
    if (title && !seasonScores(corpus).length) {
      const seasons = [
        ...corpus.matchAll(/\bseason\s+(\d+)\b/gi),
        ...corpus.matchAll(/\b(\d+)\s+seasons?\b/gi),
      ].map((match) => Number(match[1]));
      const newest = seasons.length ? Math.max(...seasons) : undefined;
      offer(newest ? `${title} season ${newest} tomatometer score` : `${title} latest season tomatometer score`);
    }
  }

  const offset = query.match(OFFSET);
  if (offset) {
    const place = query.match(/\bin ([A-Z][^?]+?) opened exactly/i);
    const opened = datesIn(corpus).find((date) => windowHas(corpus, date.at, 80, /\b(?:opened|opening)\b/i));
    if (opened) {
      const when = new Date(Date.UTC(opened.year + Number(offset[2]), opened.month, opened.day));
      const label = when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      if (!corpus.toLowerCase().includes(label.toLowerCase())) {
        offer(`${place ? clean(place[1]!) : clean(offset[1]!)} opened ${label}`);
      }
    } else {
      offer(place ? `${clean(place[1]!)} opening date` : `when ${clean(offset[3]!)}`);
    }
  }

  const born = query.match(BORN_IN);
  if (born) {
    const who = tokens(born[1]!).at(-1) ?? 'born';
    const year = yearNear(corpus, new RegExp(`\\b(?:born|birth)\\b[^.]{0,60}\\b${escapeReg(who)}\\b|\\b${escapeReg(who)}\\b[^.]{0,60}\\b(?:born|birth)\\b`, 'i'))
      ?? yearNear(corpus, /\bborn\b/i);
    if (year && !query.includes(year)) {
      const rest = clean(query)
        .replace(BORN_IN, year)
        .replace(/^(who|what|when|where)\s+(was|is|were|did)\s+/i, '');
      offer(rest);
    } else if (!year) {
      offer(`${clean(born[1]!)} birth year`);
    }
  }

  if (/\bcentury\b/i.test(query) && !/\b\d{1,2}(?:st|nd|rd|th)\s+century\b/i.test(corpus) && !yearNear(corpus, /\b(?:named|called|name|chosen|coined)\b/i)) {
    const name = novelName(query, corpus);
    if (name) offer(`${name} name origin century`);
  }

  if (/\bcaptain\b/i.test(query) && !/\bcaptain\b/i.test(corpus)) {
    const name = novelName(query, corpus);
    if (name) offer(`${name} captain`);
  }

  const age = query.match(AGE);
  if (age) {
    if (!birthOf(corpus, age[1]!)) offer(`${clean(age[1]!)} date of birth`);
    else if (!eventDate(corpus, age[2]!)) offer(`${clean(age[2]!)} date`);
  }

  const placed = query.match(IF_ON);
  if (placed && lengths(corpus).length < 2) {
    const eventHit = lengths(corpus).some((row) => tokens(placed[1]!).some((word) => windowHas(corpus, row.at, 70, new RegExp(`\\b${word}\\b`, 'i'))));
    offer(eventHit ? `${clean(placed[2]!)} length` : `${clean(placed[1]!)} distance`);
  }

  return candidates[0];
}

/** The answer implied by facts the sources already state. Undefined when a needed fact is absent. */
export function factAnswer(query: string, corpus: string): FactAnswer | undefined {
  const age = query.match(AGE);
  if (age) {
    const birth = birthOf(corpus, age[1]!);
    const event = birth && eventDate(corpus, age[2]!, birth);
    if (birth && event) {
      const years = ageAt(birth, event);
      if (years >= 0 && years < 120) {
        return {
          lead: String(years),
          label: 'Age',
          note: `${clean(age[1]!)} was born ${birth.raw}. The event was ${event.raw}. The age is ${years}. Do not use anyone else's age.`,
        };
      }
    }
  }

  const placed = query.match(IF_ON);
  if (placed) {
    const rows = lengths(corpus);
    const eventWords = tokens(placed[1]!);
    const placeWords = tokens(placed[2]!);
    // A length belongs to the thing named just before it. A wide window past the number
    // pulls in the next sentence and assigns both lengths to both things.
    const owns = (row: { at: number }, words: string[], other: string[]) => {
      const near = preceding(corpus, row.at, words);
      return near <= 160 && near < preceding(corpus, row.at, other);
    };
    const numer = rows.filter((row) => owns(row, eventWords, placeWords)).sort((a, b) => preceding(corpus, a.at, eventWords) - preceding(corpus, b.at, eventWords))[0];
    const denom = rows.filter((row) => row !== numer && owns(row, placeWords, eventWords)).sort((a, b) => preceding(corpus, a.at, placeWords) - preceding(corpus, b.at, placeWords))[0];
    if (numer && denom && miles(denom) > 0) {
      const quotient = miles(numer) / miles(denom);
      const tenth = /\bnearest tenth\b/i.test(query);
      const lead = tenth ? (Math.round(quotient * 10) / 10).toFixed(1) : String(Math.round(quotient));
      return {
        lead,
        label: 'Answer',
        note: `${numer.raw} divided by ${denom.raw} is ${lead}. Lead with ${lead}, not with either length.`,
      };
    }
  }

  if (SCORE.test(query) && NEWEST.test(query)) {
    const scores = seasonScores(corpus);
    const best = scores.sort((a, b) => b.season - a.season)[0];
    if (best) return { lead: best.score, label: 'Score', note: `The newest season with a score is season ${best.season} at ${best.score}. An earlier season is not the current one.` };
  }

  const yearAsk = query.match(WHAT_YEAR);
  if (yearAsk) {
    const verb = eventVerb(yearAsk[1]!);
    const year = verb && yearNear(corpus, verb);
    if (year) return { lead: year, label: 'Year', note: `The sources state ${year} for that event. Lead with ${year}.` };
  }

  if (/\bcentury\b/i.test(query)) {
    const said = corpus.match(/\b(\d{1,2}(?:st|nd|rd|th)|nineteenth|eighteenth|seventeenth|twentieth)\s+century\b/i);
    if (said) return { lead: `the ${said[1]!.toLowerCase()} century`.replace(/^the nineteenth/, 'the 19th').replace(/^the eighteenth/, 'the 18th').replace(/^the twentieth/, 'the 20th'), label: 'Century', note: `The sources name ${said[0]}. Lead with that century.` };
    const year = yearNear(corpus, /\b(?:named|called|name|chosen|coined)\b/i);
    if (year) {
      const lead = centuryOf(Number(year));
      return { lead, label: 'Century', note: `The name is tied to ${year}, which is ${lead}. Lead with the century.` };
    }
  }

  return undefined;
}

function nodeText(node: CardNode): string {
  switch (node.type) {
    case 'hero':
    case 'stat':
      return `${node.value} ${node.label ?? ''} ${node.type === 'hero' ? node.caption ?? '' : ''}`;
    case 'tile':
      return `${node.value ?? ''} ${node.label} ${node.sub ?? ''}`;
    case 'text':
    case 'heading':
    case 'callout':
      return node.text;
    case 'keyvalue':
      return node.items.map((item) => `${item.label} ${item.value}`).join(' ');
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return node.children.map(nodeText).join(' ');
    default:
      return '';
  }
}

/**
 * The card leads with the figure the facts imply.
 * A wrong hero number is replaced. A card that never states the figure gains a hero.
 * Undefined when the figure is already on the card.
 */
export function placeFactLead(nodes: CardNode[], fact: FactAnswer): CardNode[] | undefined {
  if (nodes.some((node) => nodeText(node).toLowerCase().includes(fact.lead.toLowerCase()))) return undefined;
  for (let i = 0; i < nodes.length; i++) {
    const next = patchFactLead(nodes[i]!, fact.lead);
    if (!next) continue;
    return nodes.map((node, at) => (at === i ? next : node));
  }
  return [{ type: 'hero', value: fact.lead, label: fact.label }, ...nodes];
}

/** The first answer-shaped number or century that is not already the grounded lead. */
export function patchFactLead(node: CardNode, lead: string): CardNode | undefined {
  if (nodeText(node).toLowerCase().includes(lead.toLowerCase())) return undefined;
  const year = /\b(?:1[6-9]|20)\d{2}\b/;
  const swapValue = (value: string | undefined): string | undefined => {
    if (!value || !/\d/.test(value) || value.toLowerCase().includes(lead.toLowerCase())) return undefined;
    if (year.test(value) && year.test(lead) === false && !lead.includes(value.match(year)?.[0] ?? '\0')) return undefined;
    return lead;
  };
  switch (node.type) {
    case 'hero':
    case 'stat': {
      if (!/\d/.test(node.value)) return { ...node, value: lead };
      const value = swapValue(node.value);
      return value ? { ...node, value } : undefined;
    }
    case 'tile': {
      const value = swapValue(node.value);
      return value ? { ...node, value } : undefined;
    }
    case 'keyvalue': {
      let changed = false;
      const items = node.items.map((item) => {
        const value = swapValue(item.value);
        if (!value || changed) return item;
        changed = true;
        return { ...item, value };
      });
      return changed ? { ...node, items } : undefined;
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      let changed = false;
      const children = node.children.map((child) => {
        if (changed) return child;
        const next = patchFactLead(child, lead);
        if (!next) return child;
        changed = true;
        return next;
      });
      return changed ? { ...node, children } : undefined;
    }
    default:
      return undefined;
  }
}
