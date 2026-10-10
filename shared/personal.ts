/**
 * On-device personalization. Storage is injected so this stays unit-testable
 * without localStorage or the DOM.
 */
import { withoutRepeatedLead } from './card.ts';
import {
  PASSING_STARTERS,
  STARTERS,
  pickShown,
  shownCount,
  type StarterKind,
  type Suggestion,
} from './starters.ts';

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Category = 'shopping' | 'compare' | 'howto' | 'decision' | 'plan' | 'other';

export interface HistoryItem {
  q: string;
  t: number;
  cat: Category;
}

export const HISTORY_KEY = 'zo:history';
/** Legacy starter cache; only removed now (the list is rebuilt from history on every render). */
export const STARTERS_CACHE_KEY = 'zo:starters:v1';
export const ASKCOUNT_KEY = 'zo:askcount';
export const RECENT_KEY = 'zo:recent';
/** Removed by clearHistory when a client persists the typeahead map. */
export const TYPEAHEAD_CACHE_KEY = 'zo:typeahead';

const MAX_HISTORY = 50;
const CATS = new Set<Category>(['shopping', 'compare', 'howto', 'decision', 'plan', 'other']);

function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* quota */
  }
}

/**
 * Cheap local classifier. More specific phrases win over the broad shopping
 * "buy" token so "should I lease or buy" stays a decision.
 */
export function categorize(q: string): Category {
  const s = q.toLowerCase();
  if (/\bvs\b|\bversus\b|\bcompare\b/.test(s)) return 'compare';
  if (/\bhow to\b|\bsteps\b|\brecipe\b/.test(s)) return 'howto';
  if (/\bshould i\b|\bworth it\b|\blease or\b/.test(s)) return 'decision';
  if (/\bplan\b|\bitinerary\b|\bschedule\b|\bweek\b/.test(s)) return 'plan';
  if (/\bbest\b|\bunder\s*\$|\bcheap\b|\bbuy\b/.test(s)) return 'shopping';
  return 'other';
}

function asCategory(value: unknown, q: string): Category {
  return typeof value === 'string' && CATS.has(value as Category) ? (value as Category) : categorize(q);
}

export function readHistory(storage: Storage): HistoryItem[] {
  try {
    const parsed = JSON.parse(readRaw(storage, HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HistoryItem[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const q = (row as { q?: unknown }).q;
      const t = (row as { t?: unknown }).t;
      if (typeof q !== 'string' || !q.trim() || typeof t !== 'number') continue;
      out.push({ q: q.trim(), t, cat: asCategory((row as { cat?: unknown }).cat, q) });
      if (out.length >= MAX_HISTORY) break;
    }
    return out;
  } catch {
    return [];
  }
}

function askCount(storage: Storage, historyLen: number): number {
  const raw = readRaw(storage, ASKCOUNT_KEY);
  if (raw == null) return historyLen;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : historyLen;
}

/** Newest first, max 50, deduped case-insensitively. Also bumps zo:askcount. */
export function recordAsk(storage: Storage, q: string, now = Date.now()): HistoryItem[] {
  const query = q.trim();
  if (!query) return readHistory(storage);
  const prev = readHistory(storage).filter((h) => h.q.toLowerCase() !== query.toLowerCase());
  const next = [{ q: query, t: now, cat: categorize(query) }, ...prev].slice(0, MAX_HISTORY);
  writeRaw(storage, HISTORY_KEY, JSON.stringify(next));
  writeRaw(storage, ASKCOUNT_KEY, String(askCount(storage, prev.length) + 1));
  return next;
}

function kindCategory(kind: StarterKind): Category {
  switch (kind) {
    case 'ranked': return 'shopping';
    case 'compare': return 'compare';
    case 'steps': return 'howto';
    case 'decision': return 'decision';
    case 'plan': return 'plan';
    case 'explain':
    case 'draw':
      return 'other';
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

function clip70(text: string): string {
  return text.length > 70 ? text.slice(0, 70).trimEnd() : text;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Words that only restate a subject ("$rdw stock", "jaylen brown news"). */
const RESTATE = new Set(['stock', 'stocks', 'share', 'shares', 'price', 'news', 'today', 'now', 'latest', 'quote', 'ticker', 'reddit', 'wiki', 'wikipedia']);
/** Light plural fold so "injuries" meets "injury" and "stats" meets "stat". */
const fold = (w: string) => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{3})s$/, '');

export type SubjectKind = 'ticker' | 'sports' | 'person' | 'general';

export interface Subject {
  /** What the ask is about, in the person's own words ("jaylen brown", "RDW"). */
  subject: string;
  /** What they asked about it ("injuries", "dropping"); '' when nothing. */
  topic: string;
  kind: SubjectKind;
}

const LEAD = /^(?:(?:who|what|when|where|why|how)(?:'s|\s+(?:is|are|was|were|did|does|do|much|many|long|old|to|can|should|would|will))?|tell me about|is it worth|latest on|more on|news on|the|is|are)\s+/i;
const TAIL = new Set([
  'injury', 'injuries', 'injured', 'stats', 'stat', 'news', 'update', 'updates', 'today', 'now', 'latest', 'tonight',
  'price', 'prices', 'stock', 'stocks', 'share', 'shares', 'earnings', 'forecast', 'contract', 'salary', 'worth', 'net',
  'age', 'height', 'wife', 'husband', 'girlfriend', 'boyfriend', 'schedule', 'score', 'scores', 'highlights', 'trade',
  'rumors', 'rumours', 'dropping', 'falling', 'rising', 'up', 'down', 'crashing', 'surging', 'drop', 'fall', 'rise',
  'jump', 'jumping', 'explained', 'meaning', 'profile', 'bio', 'career', 'record', 'status', 'return', 'game', 'games',
  'so', 'going', 'doing', 'today?',
]);
const SPORTS = /\b(injur\w*|stats?|games?|score[sd]?|trade[sd]?|contract|season|playoffs?|nba|nfl|mlb|nhl|wnba|draft|roster|highlights)\b/i;

/** Splits an ask into its subject and what was asked about it. */
export function subjectOf(q: string): Subject {
  let s = q.trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ');
  const who = /^(?:who\s+(?:is|was)|tell me about)\b/i.test(s);
  for (let i = 0; i < 3 && LEAD.test(s); i++) s = s.replace(LEAD, '');
  const ticker = /(?:^|\s)\$([A-Za-z]{1,5})\b/.exec(s)?.[1];
  if (ticker) {
    const topic = s.replace(/(?:^|\s)\$[A-Za-z]{1,5}\b/, ' ').split(/\s+/).filter((w) => w && TAIL.has(w.toLowerCase())).join(' ');
    return { subject: ticker.toUpperCase(), topic, kind: 'ticker' };
  }
  const words = s.split(' ').filter(Boolean);
  const topic: string[] = [];
  while (words.length > 1 && TAIL.has(words[words.length - 1]!.toLowerCase())) topic.unshift(words.pop()!);
  const subject = words.join(' ');
  const tickerish = /^(?:[A-Z]{2,5})$/.test(subject) && topic.some((w) => /^(stocks?|shares?|earnings|price)$/i.test(w));
  const kind: SubjectKind = tickerish ? 'ticker' : SPORTS.test(q) ? 'sports' : who ? 'person' : 'general';
  return { subject, topic: topic.join(' '), kind };
}

/** "jaylen brown" / "Ed chu" → "Jaylen Brown" / "Ed Chu" for a two- or three-word name. */
function nameCase(subject: string, kind: SubjectKind): string {
  if ((kind !== 'sports' && kind !== 'person') || !/^[a-z]+(?: [a-z]+){1,2}$/i.test(subject)) return subject;
  return subject.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Next asks for one subject, best first. */
function ideasFor(item: HistoryItem): { text: string; icon: string }[] {
  const ask = item.q.trim();
  switch (item.cat) {
    case 'shopping': return [{ text: `compare top picks for ${ask}`, icon: 'scale' }];
    case 'howto': return [{ text: `${ask} — common mistakes`, icon: 'list-checks' }];
    case 'decision': return [{ text: `pros and cons: ${ask}`, icon: 'scale' }];
    case 'compare': return [{ text: withoutRepeatedLead(/^(which is better|compare)\b/i.test(ask) ? ask : `which is better value: ${ask}`), icon: 'scale' }];
    case 'plan': return [{ text: `${ask}: checklist`, icon: 'list-checks' }];
    case 'other': break;
    default: {
      const unknown: never = item.cat;
      return unknown;
    }
  }
  const { subject, kind } = subjectOf(ask);
  const s = nameCase(subject, kind);
  switch (kind) {
    case 'ticker': return [
      { text: `${s} stock news today`, icon: 'trending-up' },
      { text: `${s} earnings date`, icon: 'calendar' },
      { text: `${s} analyst price target`, icon: 'chart-line' },
    ];
    case 'sports': return [
      { text: `${s} stats this season`, icon: 'activity' },
      { text: `${s} latest news`, icon: 'newspaper' },
      { text: `${s} next game`, icon: 'calendar' },
    ];
    case 'person': return [
      { text: `${s} latest news`, icon: 'newspaper' },
      { text: `${s} career highlights`, icon: 'user' },
    ];
    case 'general': return [
      { text: `latest on ${s}`, icon: 'newspaper' },
      { text: `${s} explained simply`, icon: 'lightbulb' },
    ];
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

/** Popular searches about a subject (from the suggest endpoint), keyed by lowercased subject. */
export type Related = Record<string, string[]>;

export const RELATED_KEY = 'zo:related:v1';
const RELATED_TTL_MS = 6 * 60 * 60 * 1000;
const RELATED_MAX = 12;

export function readRelated(storage: Storage, now = Date.now()): Related {
  try {
    const parsed = JSON.parse(readRaw(storage, RELATED_KEY) ?? '{}') as Record<string, { at?: unknown; list?: unknown }>;
    const out: Related = {};
    for (const [key, v] of Object.entries(parsed ?? {})) {
      if (!v || typeof v.at !== 'number' || now - v.at > RELATED_TTL_MS || !Array.isArray(v.list)) continue;
      out[key] = v.list.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRelated(storage: Storage, subject: string, list: string[], now = Date.now()): void {
  let parsed: Record<string, { at: number; list: string[] }> = {};
  try {
    parsed = JSON.parse(readRaw(storage, RELATED_KEY) ?? '{}') ?? {};
  } catch {
    parsed = {};
  }
  parsed[subject.toLowerCase()] = { at: now, list: list.slice(0, 8) };
  const keep = Object.entries(parsed).sort((a, b) => b[1].at - a[1].at).slice(0, RELATED_MAX);
  writeRaw(storage, RELATED_KEY, JSON.stringify(Object.fromEntries(keep)));
}

/** Distinct subjects of the newest asks, newest first: what "Try one" builds on. */
export function recentSubjects(history: HistoryItem[], max = 3): { item: HistoryItem; subject: Subject }[] {
  const seen = new Set<string>();
  const out: { item: HistoryItem; subject: Subject }[] = [];
  for (const item of history) {
    const subject = subjectOf(item.q);
    const key = norm(subject.subject);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ item, subject });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The subjects worth a related-searches lookup (people, teams, tickers and topics, not how-tos or
 * shopping lists): the cache key and the search that finds what people ask about it next.
 */
export function relatedSubjects(history: HistoryItem[], related: Related, max = 2): { key: string; query: string }[] {
  return recentSubjects(history)
    .filter(({ item, subject }) => item.cat === 'other' && subject.subject.length >= 2 && !(subject.subject.toLowerCase() in related))
    .slice(0, max)
    .map(({ subject }) => ({ key: subject.subject, query: subject.kind === 'ticker' ? `${subject.subject} stock` : subject.subject }));
}

/** Related searches for one subject that add something: not asked already, not the bare subject, not the same topic again. */
function freshRelated(list: string[], subject: Subject, asked: Set<string>): string[] {
  const subj = norm(subject.subject);
  const whole = new RegExp(`(^| )${subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const topic = new Set(norm(subject.topic).split(' ').filter(Boolean).map(fold));
  const shown = nameCase(subject.subject, subject.kind);
  const out: string[] = [];
  for (const raw of list) {
    const n = norm(raw);
    if (!n || asked.has(n) || n === subj || n.length > 60 || !whole.test(n)) continue;
    const extra = n.replace(subj, ' ').split(' ').filter(Boolean).map(fold).filter((w) => !RESTATE.has(w));
    if (!extra.length || extra.every((w) => topic.has(w))) continue;
    out.push(n.replace(subj, shown));
  }
  return out;
}

function rankedGenerics(history: HistoryItem[]): Suggestion[] {
  const freq = new Map<Category, number>();
  for (const h of history) freq.set(h.cat, (freq.get(h.cat) ?? 0) + 1);
  const pool = [
    ...PASSING_STARTERS,
    ...STARTERS.filter((s) => s.id.startsWith('v2b-')),
  ];
  const seen = new Set<string>();
  return pool
    .map((s, i) => ({ s, i, f: freq.get(kindCategory(s.kind)) ?? 0 }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .filter(({ s }) => !seen.has(s.text.toLowerCase()) && !!seen.add(s.text.toLowerCase()))
    .map(({ s }) => ({ id: s.id, text: s.text, icon: s.icon, group: s.group }));
}

/**
 * The personalized list: next asks built from the subjects of the newest asks (round-robin, so
 * one topic never fills the list), popular related searches for those subjects first, then
 * curated starters ranked by the categories asked most. Nothing already asked is offered.
 */
export function computeItems(history: HistoryItem[], related: Related = {}, want = 4): Suggestion[] {
  const asked = new Set(history.map((h) => norm(h.q)));
  const lanes = recentSubjects(history).map(({ item, subject }) => {
    const pop = freshRelated(related[subject.subject.toLowerCase()] ?? [], subject, asked).slice(0, 2).map((text) => ({ text, icon: 'search' }));
    return [...pop, ...ideasFor(item)];
  });
  const out: Suggestion[] = [];
  const seen = new Set<string>(asked);
  const personal = Math.max(1, want - 1);
  for (let round = 0; out.length < personal && lanes.some((l) => l.length > round); round++) {
    for (const lane of lanes) {
      const idea = lane[round];
      if (!idea || out.length >= personal) continue;
      const text = clip70(idea.text);
      const key = norm(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `p-${out.length}-${key.replace(/\s+/g, '-').slice(0, 40)}`, text, icon: idea.icon, group: 'broad' });
    }
  }
  for (const g of rankedGenerics(history)) {
    if (out.length >= want) break;
    if (seen.has(norm(g.text))) continue;
    seen.add(norm(g.text));
    out.push(g);
  }
  return out;
}

/**
 * Cold start (no history) returns the generic Strategy set. Otherwise the list is rebuilt from the
 * newest asks every time (it is cheap and must follow what was just asked), with any related
 * searches already fetched for those subjects.
 */
export function personalizedStarters(storage: Storage, width: number, now = Date.now()): { items: Suggestion[]; personalized: boolean } {
  const history = readHistory(storage);
  if (!history.length) return { items: pickShown(width), personalized: false };
  const want = shownCount(width);
  return { items: computeItems(history, readRelated(storage, now), want), personalized: true };
}

export function clearHistory(storage: Storage): void {
  for (const key of [HISTORY_KEY, STARTERS_CACHE_KEY, ASKCOUNT_KEY, RECENT_KEY, TYPEAHEAD_CACHE_KEY, RELATED_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
