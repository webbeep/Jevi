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
  /** Numbers the lead was computed from. A patch must not overwrite them. */
  keep?: string[];
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
const VERBS: { ask: RegExp; near: RegExp; past: string }[] = [
  { ask: /\bsell\b/i, near: /\b(?:sell|sold|sale|selling)\b/i, past: 'sold' },
  { ask: /\b(?:found|founded)\b/i, near: /\b(?:found|founded|founding)\b/i, past: 'founded' },
  { ask: /\bopen(?:ed)?\b/i, near: /\b(?:open|opened|opening)\b/i, past: 'opened' },
  { ask: /\b(?:die|died)\b/i, near: /\b(?:die|died|death)\b/i, past: 'died' },
  { ask: /\b(?:win|won)\b/i, near: /\b(?:win|won|winning)\b/i, past: 'won' },
  { ask: /\b(?:leave|left)\b/i, near: /\b(?:leave|left)\b/i, past: 'left' },
  { ask: /\b(?:marry|married)\b/i, near: /\b(?:marry|married|marriage|wedding)\b/i, past: 'married' },
  { ask: /\b(?:publish|published)\b/i, near: /\b(?:publish|published)\b/i, past: 'published' },
  { ask: /\b(?:release|released)\b/i, near: /\b(?:release|released)\b/i, past: 'released' },
  { ask: /\bborn\b/i, near: /\bborn\b/i, past: 'born' },
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

/** Pages say "sold", not "what year did she sell". The follow-up search uses that past tense. */
function pastClause(clause: string): string {
  const verb = VERBS.find((item) => item.ask.test(clause));
  return clean(verb ? clause.replace(verb.ask, verb.past) : clause);
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
  const re = /season\s+(\d+)[^\d%]{0,140}(\d{1,3})\s*(?:%|percent\b)|(\d{1,3})\s*(?:%|percent\b)[^\d%]{0,140}season\s+(\d+)/gi;
  for (const match of text.matchAll(re)) {
    const season = Number(match[1] ?? match[4]);
    const score = match[2] ?? match[3];
    if (season && score && Number(score) <= 100) out.push({ season, score: `${score}%` });
  }
  return out;
}

/** A what-year hero whose year is not the one next to the event verb. */
export function unsupportedYear(query: string, corpus: string, value: string): boolean {
  if (!WHAT_YEAR.test(query) || !/^\d{4}$/.test(value)) return false;
  const clause = query.match(WHAT_YEAR)?.[1] ?? query;
  const verb = eventVerb(clause);
  if (!verb) return false;
  return yearNear(corpus, verb) !== value;
}

interface LengthRow {
  n: number;
  unit: 'mi' | 'km';
  at: number;
  raw: string;
}

function lengths(text: string): LengthRow[] {
  const out: LengthRow[] = [];
  const re = /(\d+(?:\.\d+)?)\s*-?\s*(miles|mile|mi|km|kilometers|kilometres)\b/gi;
  for (const match of text.matchAll(re)) {
    const unit = /km|kilometer/i.test(match[2]!) ? 'km' : 'mi';
    out.push({ n: Number(match[1]), unit, at: match.index ?? 0, raw: match[0] });
  }
  return out;
}

function miles(row: { n: number; unit: 'mi' | 'km' }): number {
  return row.unit === 'km' ? row.n / 1.60934 : row.n;
}

/** How many of these words sit in the same sentence as the measurement, and how close the nearest one is. */
function sideScore(text: string, at: number, words: string[]): { hits: number; dist: number } {
  const clause = clauseAt(text, at);
  const from = text.lastIndexOf(clause, at);
  const origin = from < 0 ? 0 : from;
  let hits = 0;
  let dist = Infinity;
  for (const word of words) {
    const stem = word.endsWith('s') && word.length > 4 ? word.slice(0, -1) : word;
    const found = [...clause.matchAll(new RegExp(`\\b(?:${escapeReg(word)}|${escapeReg(stem)})\\b`, 'gi'))];
    if (!found.length) continue;
    hits += 1;
    for (const match of found) dist = Math.min(dist, Math.abs(at - (origin + (match.index ?? 0))));
  }
  return { hits, dist };
}

function lengthPrecision(row: LengthRow): number {
  const decimals = row.raw.match(/\.(\d+)/)?.[1]?.length ?? 0;
  return decimals + (row.unit === 'mi' ? 0.1 : 0);
}

/** Two writings of one distance (2 miles and 3.4 kilometres, or 2.11 miles and 3.40 kilometres) are one length. The more precise writing is kept. */
function collapseLengths(rows: LengthRow[]): LengthRow[] {
  const out: LengthRow[] = [];
  for (const row of rows) {
    const span = miles(row);
    const twinAt = out.findIndex((kept) => Math.abs(miles(kept) - span) <= Math.max(0.15, miles(kept) * 0.08));
    if (twinAt < 0) out.push(row);
    else if (lengthPrecision(row) > lengthPrecision(out[twinAt]!)) out[twinAt] = row;
  }
  return out;
}

function ratioAnswer(query: string, corpus: string): FactAnswer | undefined {
  const placed = query.match(IF_ON);
  if (!placed) return undefined;
  const rows = lengths(corpus);
  const eventWords = tokens(placed[1]!);
  const placeWords = tokens(placed[2]!);
  if (!eventWords.length || !placeWords.length || rows.length < 2) return undefined;
  const ranked = (words: string[], other: string[]) => rows
    .map((row) => ({ row, own: sideScore(corpus, row.at, words), other: sideScore(corpus, row.at, other) }))
    .filter((item) => item.own.hits > 0 && (item.own.hits > item.other.hits || (item.own.hits === item.other.hits && item.own.dist < item.other.dist)))
    .sort((a, b) => b.own.hits - a.own.hits || a.own.dist - b.own.dist);
  const events = ranked(eventWords, placeWords);
  const places = ranked(placeWords, eventWords);
  const numer = collapseLengths(events.map((item) => item.row))[0];
  const denom = collapseLengths(places.map((item) => item.row))[0];
  if (!numer || !denom || miles(denom) <= 0) return undefined;
  const quotient = miles(numer) / miles(denom);
  if (!Number.isFinite(quotient) || quotient <= 0 || quotient > 1000) return undefined;
  const tenth = /\bnearest tenth\b/i.test(query);
  const lead = tenth ? (Math.round(quotient * 10) / 10).toFixed(1) : String(Math.round(quotient));
  return {
    lead,
    label: 'Answer',
    note: `${numer.raw} divided by ${denom.raw} is ${lead}. Lead with ${lead}, not with either length.`,
    keep: [...events, ...places].map((item) => String(item.row.n)),
  };
}

function centuryOf(year: number): string {
  const n = Math.ceil(year / 100);
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `the ${n}${suffix} century`;
}

const CENTURY_WORD = /\b(\d{1,2}(?:st|nd|rd|th)|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first)\s+century\b/gi;
const NAMING_CLAUSE = /\b(?:chosen|named|called|coined|current name|name was|name dates|known as)\b/i;
const ORIGIN_CLAUSE = /\b(?:harks? back|dates? back|originat\w*|originally|birthday|tradition)\b/i;

function centuryLead(raw: string): string {
  const map: Record<string, string> = {
    sixteenth: '16th', seventeenth: '17th', eighteenth: '18th', nineteenth: '19th', twentieth: '20th', 'twenty-first': '21st',
  };
  const word = raw.toLowerCase();
  return `the ${map[word] ?? word} century`;
}

function clauseAt(text: string, at: number): string {
  let start = 0;
  for (const mark of ['.', '\n', ';', '!', '?']) {
    const found = text.lastIndexOf(mark, Math.max(0, at - 1));
    if (found >= start) start = found + 1;
  }
  let end = text.length;
  for (const mark of ['.', '\n', ';', '!', '?']) {
    const found = text.indexOf(mark, at);
    if (found !== -1 && found < end) end = found;
  }
  return text.slice(start, end);
}

/** The century in the same clause as the naming, not the century the custom began. */
function namingCentury(corpus: string): string | undefined {
  let mixed: string | undefined;
  for (const match of corpus.matchAll(new RegExp(CENTURY_WORD.source, 'gi'))) {
    const clause = clauseAt(corpus, match.index ?? 0);
    if (!NAMING_CLAUSE.test(clause)) continue;
    const lead = centuryLead(match[1]!);
    if (!ORIGIN_CLAUSE.test(clause)) return lead;
    mixed ??= lead;
  }
  return mixed;
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
  const act = memberAct(query);
  const work = memberWork(query);
  if (act && work && MEMBER_ASK.test(query)) return [`${work} ${act} appearances`];
  return [];
}

const MEMBER_ASK = /\bwhich\b[\s\S]{0,180}\b(?:have|has|had|did|does|appeared|appear)\b/i;

function memberWork(query: string): string | undefined {
  return query.match(/\b(?:series|show|film|movie|play|band|team)\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)*)/)?.[1];
}

function memberAct(query: string): string | undefined {
  const match = query.match(/\b(?:appeared|appear|starred|featured)\s+in\s+(?:an?\s+|the\s+)?([a-z][a-z\s]{2,40}?)(?:\?|$)/i);
  const phrase = match?.[1]?.trim().toLowerCase().replace(/s$/, '');
  return phrase && phrase.length >= 5 ? phrase : undefined;
}

function sentenceAround(text: string, at: number): string {
  let start = 0;
  for (const mark of ['.', '\n', '!', '?']) {
    const found = text.lastIndexOf(mark, Math.max(0, at - 1));
    if (found >= start) start = found + 1;
  }
  let end = text.length;
  for (const mark of ['.', '\n', '!', '?']) {
    const found = text.indexOf(mark, at);
    if (found !== -1 && found < end) end = found;
  }
  return text.slice(start, end);
}

function priorSentence(text: string, at: number): string {
  const before = text.slice(0, Math.max(0, at));
  const end = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'));
  if (end <= 0) return '';
  return sentenceAround(before, Math.max(0, end - 1));
}

/** A theme list or a cast list does not count. The verb has to be about this person. */
function individualInCorpus(corpus: string, name: string, act: string): boolean {
  const surname = name.split(/\s+/).at(-1) ?? name;
  if (surname.length < 3) return false;
  const verb = /\b(?:appeared|appears|appear|starred|stars|featured|features|starring|seen|been)\b/i;
  for (const match of corpus.matchAll(new RegExp(`\\b${escapeReg(surname)}\\b`, 'gi'))) {
    const at = match.index ?? 0;
    const sentence = sentenceAround(corpus, at);
    if (/\btheme\s+(?:song|video)\b/i.test(sentence)) continue;
    if (/\b(?:the\s+)?(?:main\s+|entire\s+|whole\s+)?cast\b/i.test(sentence) && !new RegExp(`\\b${escapeReg(surname)}\\s+(?:appeared|appears|starred|featured|was|is)\\b`, 'i').test(sentence)) continue;
    const names = sentence.match(/\b[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})+\b/g) ?? [];
    if (names.length >= 3) continue;
    const prior = priorSentence(corpus, at).toLowerCase();
    if (!sentence.toLowerCase().includes(act) && !prior.includes(act)) continue;
    const verbAt = sentence.search(verb);
    if (verbAt < 0) continue;
    const nearest = (sentence.slice(0, verbAt).match(/\b[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})+\b/g) ?? []).at(-1);
    if (nearest && nearest.toLowerCase().endsWith(surname.toLowerCase())) return true;
  }
  return false;
}

/** True when this is a which-members question and a row already names the work. */
export function hasMemberWork(query: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): boolean {
  const work = memberWork(query);
  if (!work || !MEMBER_ASK.test(query)) return false;
  const needle = work.toLowerCase();
  return rows.some((row) => `${row.title ?? ''} ${row.snippet ?? ''} ${row.url ?? ''}`.toLowerCase().includes(needle));
}

/**
 * Pages about the named work lead.
 * A follow-up that missed the work does not get read ahead of those pages.
 */
export function leadMemberRows<T extends { title?: string; snippet?: string; url?: string }>(
  query: string,
  rows: readonly T[],
  pinned: readonly string[] = [],
): T[] {
  const work = memberWork(query);
  if (!work || !MEMBER_ASK.test(query)) return [...rows];
  const pin = new Set(pinned);
  const needle = work.toLowerCase();
  const about = (row: T) => `${row.title ?? ''} ${row.snippet ?? ''} ${row.url ?? ''}`.toLowerCase().includes(needle);
  const pinnedRows = rows.filter((row) => row.url && pin.has(row.url));
  const rest = rows.filter((row) => !(row.url && pin.has(row.url)));
  // The named work is read first. A follow-up that missed the work does not bury those pages.
  return [
    ...pinnedRows.filter(about),
    ...rest.filter(about),
    ...pinnedRows.filter((row) => !about(row)),
    ...rest.filter((row) => !about(row)),
  ];
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
      const past = `${pastClause(yearAsk[1]!)} year`;
      const asked = (ctx.asked ?? []).map((item) => item.toLowerCase());
      if (!asked.includes(past.toLowerCase())) offer(past);
      else {
        const name = yearAsk[1]!.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}/);
        const pastWord = VERBS.find((item) => item.ask.test(yearAsk[1]!))?.past;
        if (name && pastWord) offer(`${name[0]} ${pastWord}`);
      }
    }
  }

  if (SCORE.test(query) && NEWEST.test(query)) {
    const title = showTitle(query);
    if (title) {
      const scores = seasonScores(corpus);
      const mentioned = [
        ...corpus.matchAll(/\bseason\s+(\d+)\b/gi),
        ...corpus.matchAll(/\b(\d+)\s+seasons?\b/gi),
      ].map((match) => Number(match[1])).filter((n) => n > 0 && n < 40);
      const scoredMax = scores.reduce((max, row) => Math.max(max, row.season), 0);
      const mentionedMax = mentioned.reduce((max, n) => Math.max(max, n), 0);
      const lookedAhead = (ctx.asked ?? []).some((item) => /season\s+\d+\s+rotten tomatoes/i.test(item));
      // One season past the highest scored one. A later season named only as upcoming is not searched again.
      const target = !scores.length ? mentionedMax : !lookedAhead ? scoredMax + 1 : 0;
      if (target > scoredMax) {
        offer(target ? `${title} season ${target} rotten tomatoes` : `${title} latest season rotten tomatoes`);
      }
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

  if (/\bwhich\b/i.test(query) && /\b(?:appeared|appear|have|has)\b/i.test(query)) {
    const act = query.match(/\b(?:appeared|appear)\s+in\s+(?:an?\s+|the\s+)?([a-z][a-z\s]{2,30}?)(?:\?|$)/i)?.[1]?.trim().replace(/s$/, '');
    if (act && act.length >= 5) {
      const skip = new Set(['main', 'cast', 'music', 'video', 'north', 'south', 'east', 'west', 'new', 'york', 'great', 'the', 'theme', 'from', 'there', 'late', 'show', 'members', 'member', 'famous', 'actors', 'actor', 'iconic', 'these', 'stars', 'star', 'another', 'when', 'complete', 'song', 'list', 'fandom', 'central', 'miss', 'may', 'mtv', 'vault', 'full', 'crew', 'official', 'friends', 'rembrandts']);
      const personLike = (name: string) => {
        const parts = name.replace(/\s+/g, ' ').trim().split(' ');
        if (parts.length < 2 || parts.length > 3) return false;
        return parts.every((part) => part.length >= 3 && part !== part.toUpperCase() && /^[A-Z]/.test(part) && !skip.has(part.toLowerCase()));
      };
      const names = [...new Set([...corpus.matchAll(/\b[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})+\b/g)].map((match) => match[0].replace(/\s+/g, ' ')))]
        .filter((name) => !query.toLowerCase().includes(name.toLowerCase()))
        .filter(personLike);
      const credited = (name: string) => individualInCorpus(corpus, name, act);
      const roster = names.filter((name) => {
        const at = corpus.indexOf(name);
        return /\b(?:cast|starring|members)\b/i.test(corpus.slice(Math.max(0, at - 90), at + name.length + 90));
      });
      const pool = roster.length >= 3 ? roster : names;
      const pending = pool.filter((name) => !credited(name));
      if (pending.length) offer(`${pending[0]} ${act} appearance`);
      else if (names.length >= 3 && !names.some(credited)) offer(`${names[0]} ${act} appearance`);
    }
  }

  if (/\bcentury\b/i.test(query)) {
    const naming = /\b(?:name|named|called|chosen|coined)\b/i.test(query);
    const found = naming
      ? namingCentury(corpus) ?? yearNear(corpus, /\b(?:named|called|chosen|coined)\b/i)
      : corpus.match(new RegExp(CENTURY_WORD.source, 'i'))?.[0];
    if (!found) {
      const name = novelName(query, corpus);
      if (name) offer(naming ? `${name} current name chosen` : `${name} century`);
    }
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

  const ratio = ratioAnswer(query, corpus);
  if (ratio) return ratio;

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
    const naming = /\b(?:name|named|called|chosen|coined)\b/i.test(query);
    if (naming) {
      const said = namingCentury(corpus);
      if (said) return { lead: said, label: 'Century', note: `The sources tie the name to ${said}. Lead with that century, not the century the custom began.` };
      const year = yearNear(corpus, /\b(?:named|called|chosen|coined)\b/i);
      if (year) {
        const lead = centuryOf(Number(year));
        return { lead, label: 'Century', note: `The name is tied to ${year}, which is ${lead}. Lead with the century.` };
      }
      return undefined;
    }
    const said = corpus.match(new RegExp(CENTURY_WORD.source, 'i'));
    if (said?.[1]) return { lead: centuryLead(said[1]), label: 'Century', note: `The sources name ${said[0]}. Lead with that century.` };
    const year = yearNear(corpus, /\b(?:named|called|name|chosen|coined)\b/i);
    if (year) {
      const lead = centuryOf(Number(year));
      return { lead, label: 'Century', note: `The name is tied to ${year}, which is ${lead}. Lead with the century.` };
    }
  }

  return undefined;
}

/** The same figure, read off the card when the card already states the inputs. */
export function cardFacts(query: string, nodes: CardNode[]): FactAnswer | undefined {
  return factAnswer(query, nodes.map(nodeText).join('\n'));
}

function hasLead(text: string, lead: string): boolean {
  const escaped = escapeReg(lead.trim());
  if (!escaped) return false;
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, 'i').test(text);
}

function keptNumber(value: string, raw: string): boolean {
  const n = raw.match(/\d+(?:\.\d+)?/)?.[0];
  if (!n) return false;
  return new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d.])`).test(value);
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
    case 'slider':
      return `${node.label} ${node.value} ${node.unit ?? ''}`;
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
function centuryLeadValue(lead: string): boolean {
  return /^the \d{1,2}(?:st|nd|rd|th) century$/i.test(lead.trim());
}

/** The hero names a different century than the one the naming sources support. */
function heroCenturyConflicts(nodes: readonly CardNode[], fact: FactAnswer): boolean {
  if (!centuryLeadValue(fact.lead)) return false;
  return nodes.some((node) => node.type === 'hero' && /\bcentury\b/i.test(node.value) && !hasLead(node.value, fact.lead));
}

export function placeFactLead(nodes: CardNode[], fact: FactAnswer): CardNode[] | undefined {
  if (heroCenturyConflicts(nodes, fact)) {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.type !== 'hero' || !/\bcentury\b/i.test(node.value) || hasLead(node.value, fact.lead)) return node;
      changed = true;
      return { ...node, value: fact.lead, label: fact.label || node.label };
    });
    return changed ? next : undefined;
  }
  if (nodes.some((node) => hasLead(nodeText(node), fact.lead))) return undefined;
  const keep = fact.keep ?? [];
  for (let i = 0; i < nodes.length; i++) {
    const next = patchFactLead(nodes[i]!, fact.lead, keep);
    if (!next) continue;
    return nodes.map((node, at) => (at === i ? next : node));
  }
  return [{ type: 'hero', value: fact.lead, label: fact.label }, ...nodes];
}

/** The first answer-shaped number or century that is not already the grounded lead. */
export function patchFactLead(node: CardNode, lead: string, keep: readonly string[] = []): CardNode | undefined {
  if (hasLead(nodeText(node), lead)) return undefined;
  const year = /\b(?:1[6-9]|20)\d{2}\b/;
  const swapValue = (value: string | undefined): string | undefined => {
    if (!value || !/\d/.test(value) || hasLead(value, lead)) return undefined;
    if (keep.length) {
      let changed = false;
      // Citations like [6] are source numbers. Replacing one hides the quotient inside a bracket.
      const next = value.replace(/\[(\d+)\]|(\d+(?:\.\d+)?)(\s*-?\s*(?:miles|mile|mi|km|kilometers|kilometres|feet|foot|ft|meters|metres|m|hours|hour|minutes|mins)\b|[kK]\b)?/gi, (full, cite: string | undefined, num: string | undefined, unit: string | undefined) => {
        if (cite || unit || !num) return full;
        if (keep.some((item) => keptNumber(num, item))) return full;
        if (/^(?:1[6-9]|20)\d{2}$/.test(num)) return full;
        changed = true;
        return lead;
      });
      return changed ? next : undefined;
    }
    if (year.test(value) && year.test(lead) === false && !lead.includes(value.match(year)?.[0] ?? '\0')) return undefined;
    return lead;
  };
  switch (node.type) {
    case 'hero':
    case 'stat': {
      if (!/\d/.test(node.value) && !keep.length) return { ...node, value: lead };
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
        if (!value || (!keep.length && changed)) return item;
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
        if (changed && !keep.length) return child;
        const next = patchFactLead(child, lead, keep);
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

const CENTURY_PHRASE = /\b(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)|(?<![\d])(?:st|nd|rd|th))\s+century\b/gi;

/** A blank "th century", or a naming clause's century, becomes the century the sources support. */
function rewriteCentury(text: string, lead: string, forceNaming = false): string {
  return text.replace(new RegExp(CENTURY_PHRASE.source, 'gi'), (full: string, offset: number) => {
    if (/^(?:the\s+)?(?:st|nd|rd|th)\s+century$/i.test(full)) return lead;
    const clause = forceNaming ? text : clauseAt(text, offset);
    const naming = forceNaming || NAMING_CLAUSE.test(clause);
    const origin = ORIGIN_CLAUSE.test(clause);
    if (!naming || origin) return full;
    const core = full.toLowerCase().replace(/^the\s+/, '');
    const want = lead.toLowerCase().replace(/^the\s+/, '');
    return core === want ? full : lead;
  });
}

/**
 * The naming century is written out in the card.
 * A blank ordinal is filled. The century the custom began stays in an origin clause.
 */
export function alignFactProse(nodes: CardNode[], fact: FactAnswer): CardNode[] | undefined {
  if (!centuryLeadValue(fact.lead)) return undefined;
  let changed = false;
  const lead = fact.lead;
  const walk = (node: CardNode): CardNode => {
    switch (node.type) {
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        return { ...node, children: node.children.map(walk) };
      case 'tabs':
        return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map(walk) })) };
      case 'text':
      case 'callout':
      case 'quote':
      case 'draft':
      case 'heading': {
        const text = rewriteCentury(node.text, lead);
        if (text === node.text) return node;
        changed = true;
        return { ...node, text };
      }
      case 'hero': {
        if (!node.caption) return node;
        const caption = rewriteCentury(node.caption, lead);
        if (caption === node.caption) return node;
        changed = true;
        return { ...node, caption };
      }
      case 'stat':
        return node;
      case 'keyvalue': {
        const items = node.items.map((item) => {
          const value = rewriteCentury(item.value, lead, NAMING_CLAUSE.test(item.label));
          if (value === item.value) return item;
          changed = true;
          return { ...item, value };
        });
        return { ...node, items };
      }
      case 'tile': {
        const naming = NAMING_CLAUSE.test(node.label);
        const value = node.value ? rewriteCentury(node.value, lead, naming) : node.value;
        const sub = node.sub ? rewriteCentury(node.sub, lead, naming) : node.sub;
        if (value === node.value && sub === node.sub) return node;
        changed = true;
        return { ...node, value, sub };
      }
      case 'list': {
        const items = node.items.map((item) => {
          const text = rewriteCentury(item.text, lead);
          if (text === item.text) return item;
          changed = true;
          return { ...item, text };
        });
        return { ...node, items };
      }
      case 'timeline':
      case 'profile':
      case 'steps':
      case 'accordion':
      case 'proscons':
      case 'badges':
      case 'actions':
      case 'choices':
      case 'links':
      case 'citations':
      case 'chart':
      case 'pricing':
      case 'scaler':
      case 'slider':
      case 'reveal':
      case 'image':
      case 'gallery':
      case 'video':
      case 'code':
      case 'divider':
      case 'progress':
      case 'rating':
      case 'diagram':
      case 'ticker':
      case 'slot':
      case 'table':
        return node;
      default: {
        const unreachable: never = node;
        return unreachable;
      }
    }
  };
  const next = nodes.map(walk);
  return changed ? next : undefined;
}
