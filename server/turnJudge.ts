import { titleSubject } from '../shared/titleSubject';
import { cleanSideName, sameObject } from '../shared/objects';
import { hasLlm, llmJson } from './llm';
import { compareSides, withoutLeadVerb } from './patterns';
import type { Env } from './util';

/**
 * One model call decides the next action. The card templates and the loading
 * animation stay fixed. This call does not choose a layout.
 */
export interface TurnDecision {
  action: 'search' | 'answer' | 'calculate';
  queries: string[];
  subject: string;
}

export interface SourceDecision {
  enough: boolean;
  query: string;
}

const TURN = `You decide the next action for a follow-up in a search conversation. Reply as JSON: {"action":"search"|"answer"|"calculate","queries":string[],"subject":string}
- subject: the thing this turn is about. Keep the subject already on screen unless the person clearly changes topic. A place or business named only as a qualifier (from X, in X, for a visitor) is not a new subject. If they challenge the subject and the card rejected that name, keep the subject the card affirmed, not the name they proposed.
- action "answer" when the card and the sources already state the fact this turn asks. queries is empty. A different case of the same subject (another visitor, another city, another option) is not answered by the previous case's figure. If that case is not already stated, action is "search" and the query names it.
- action "search" when they do not. queries is 1 to 4 web searches, the new words plus that subject, each 3-12 words. When the card is a comparison and the follow-up asks for specs, prices, or a table, return one query per product already named on the card: that product's name plus the new words. Do not drop a side, and do not glue the names into one token. When they add an object or switch to a different one, one query is that object's name alone. Do not append the follow-up sentence onto a product name. A variant (Pro, Plus, Max, Mini, Ultra) is a different product: search the exact model asked, not a different variant. A how-to, a requested quote, a live price, a tax, a fee, or a health question searches the official page for that subject.
- action "calculate" when they ask to split, multiply, or apply a rate or price already on the card. queries is empty. The figure on the card is the figure to use.
- Do not add a person, place, or business that the follow-up and the subject do not name.`;

const SOURCES = `You have a question and the first search snippets. Reply as JSON: {"enough":boolean,"query":string}
enough is true when these snippets can answer, including the steps of a how-to, the sentence of a requested quote, the official price or fee, or the health verdict.
enough is false when that fact, the official page, or one side of a comparison is missing. query is the one search that would find it, or "" when enough.
When the question asks for people, products, or other named things, enough is false unless the snippets name them. query searches for those names. A paraphrase of what to look for is not that search.
A variant (Pro, Plus, Max, Mini, Ultra) the question did not name is not the product asked.`;

/** The place or business the card title names. "Art Institute of Chicago Illinois Resident…" → "Art Institute of Chicago". */
export function placeOnScreen(title: string | undefined): string {
  if (!title) return '';
  // "How Much Does a Nintendo Switch 2 Cost…" is about the Nintendo Switch 2: the question words before the name go.
  const named = title.replace(/^\s*(?:how(?:\s+(?:much|many|long|far|big|old|often|tall))?|what|when|where|who|why|which)\b[^A-Z]*?\b(?:does|do|did|is|are|was|were|can|could|should|will|would)\s+(?:(?:a|an|the)\s+)?/i, '');
  const words = named.replace(/[“”"'’?—–-]/g, ' ').split(/\s+/).filter(Boolean);
  const skip = /^(?:No|Yes|The|How|What|When|Where|Who|Why|Which|It|Its|That|This|These|Those|There|Here|Is|Are|Was|Did|Does|Do)$/i;
  const out: string[] = [];
  for (const word of words) {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!bare) continue;
    const cap = /^[A-Z]/.test(bare);
    const of = /^of$/i.test(bare);
    if (!out.length) {
      if (cap && !skip.test(bare)) out.push(bare);
      continue;
    }
    if (of) {
      out.push('of');
      continue;
    }
    // A model number stays with its name: "Switch 2", "iPhone 17".
    if (cap || /^\d+[A-Za-z]{0,3}$/.test(bare)) {
      out.push(bare);
      continue;
    }
    break;
  }
  const ofAt = out.indexOf('of');
  const name = ofAt >= 0 && out.length > ofAt + 1 ? out.slice(0, ofAt + 2) : out.slice(0, 4);
  // "Empire State Building Height" is about the Empire State Building.
  return titleSubject(name.join(' '));
}

const ADD_LEAD = /^(?:please\s+)?(?:add|include|also(?:\s+add)?|plus)\b[\s,:.-]*/i;
const SWITCH_LEAD = /^(?:please\s+)?(?:switch to|instead(?:\s+of)?|what about|how about)\b[\s,:.-]*/i;
const ATTR_STOP = new Set([
  'what', 'whats', 'how', 'why', 'when', 'where', 'who', 'which', 'the', 'of', 'each', 'both',
  'these', 'those', 'this', 'that', 'camera', 'cameras', 'product', 'products', 'model', 'models',
  'one', 'ones', 'their', 'its', 'for', 'and', 'with', 'from', 'about', 'long', 'does', 'did',
  'many', 'much', 'are', 'tell', 'please', 'can', 'could', 'should', 'would', 'per', 'all',
  'them', 'they', 'you', 'your', 'into', 'onto', 'also', 'add', 'include', 'plus', 'show',
  'find', 'list', 'explain', 'describe', 'summarize', 'watch', 'compare', 'versus', 'have',
  'has', 'had', 'was', 'were', 'will',
]);

function uniqueSides(sides: string[]): string[] {
  const out: string[] = [];
  for (const side of sides) {
    if (side.length < 2 || out.some((have) => sameObject(have, side))) continue;
    out.push(side);
  }
  return out;
}

/** Words that name the fact, not the objects already on the card. */
function attributeWords(question: string, sides: string[]): string {
  const known = new Set(sides.flatMap((side) => side.toLowerCase().split(/[^a-z0-9]+/)).filter((word) => word.length > 1));
  return question
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter((word) => word.length > 2 && !ATTR_STOP.has(word) && !known.has(word))
    .join(' ');
}

/** A name the follow-up introduces. "Add the Glowband 4" is Glowband 4. "What is the battery life" is not a name. */
function objectPhrase(question: string, sides: string[]): { name: string; kind: 'add' | 'switch' } | undefined {
  const asked = question.trim();
  let kind: 'add' | 'switch' | undefined;
  let rest = asked;
  if (SWITCH_LEAD.test(asked)) {
    kind = 'switch';
    rest = asked.replace(SWITCH_LEAD, '');
  } else if (ADD_LEAD.test(asked)) {
    kind = 'add';
    rest = asked.replace(ADD_LEAD, '');
  } else {
    const versus = asked.match(/\b(?:vs\.?|versus)\s+(.+)$/i);
    if (!versus?.[1]) return undefined;
    kind = 'add';
    rest = versus[1];
  }
  rest = rest.split(/\s+(?:vs\.?|versus)\s+/i)[0] ?? rest;
  const name = cleanSideName(rest).replace(/[.?!]+$/g, '').trim();
  if (name.length < 2 || /^(?:what|how|why|when|where|who|which)\b/i.test(name)) return undefined;
  if (sides.some((side) => sameObject(side, name))) return undefined;
  if (!/\d/.test(name) && !/[A-Z]/.test(rest)) return undefined;
  return { name, kind };
}

/**
 * "Add X" on a comparison keeps every side and adds X.
 * The card title or the original question can name the sides. Undefined when this is not an add.
 */
export function addedComparison(question: string, titles: readonly string[]): { query: string; fanout: string[]; added: string } | undefined {
  if (!ADD_LEAD.test(question.trim())) return undefined;
  let sides: string[] = [];
  for (const title of titles) {
    const found = uniqueSides(compareSides(title).map((side) => cleanSideName(side)));
    if (found.length >= 2) {
      sides = found;
      break;
    }
  }
  if (sides.length < 2) return undefined;
  const intro = objectPhrase(question, sides);
  if (!intro || intro.kind !== 'add') return undefined;
  const next = [...sides, intro.name];
  return { query: next.join(' vs '), fanout: [intro.name, ...sides], added: intro.name };
}

/** The searches for this follow-up. A comparison keeps every product in the query and in the fan-out. */
/** The side a lead sentence names: "One WTC" in "No — One World Trade Center is still the tallest" (an initialism counts). */
export function sideNamed(lead: string, side: string): boolean {
  const text = lead.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (text.toLowerCase().includes(side.toLowerCase())) return true;
  const initials = text.split(/[^A-Za-z0-9]+/).filter((word) => /^[A-Z]/.test(word)).map((word) => word[0]).join('');
  const words = side.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => {
    if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return true;
    return /^[A-Z]{2,5}$/.test(word) && initials.includes(word);
  });
}

const QUALIFIER_LEAD = /^(?:for|in|at|near|with|without|on|during|from|by|if|under|over)\b/i;
const PLACE_STOP = new Set(['the', 'and', 'for', 'of', 'new', 'state', 'city', 'today', 'near']);

/** The search names the subject on screen: in full, or by a distinctive word of it ("Met" of "NY State Met"). */
function mentionsPlace(written: string, place: string): boolean {
  const text = written.toLowerCase();
  if (text.includes(place.toLowerCase())) return true;
  const words = text.split(/[^a-z0-9]+/);
  return place.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length >= 3 && !PLACE_STOP.has(word) && words.includes(word));
}

const POINTER = /\b(?:it|its|it's|they|them|their|this|that|these|those|he|she|his|her)\b/i;
const SINGULAR_POINTER = /\b(?:it|its|it's|he|she|his|her)\b/i;

/** The name a lead affirms when it rejects the person's claim: "No — One World Trade Center is still the tallest". */
export function rejectionAffirms(lead: string): string | undefined {
  const match = lead.match(/^\s*No\b[\s,.:;!—–-]+(?:the\s+)?([A-Z0-9][\w.'’&-]*(?:\s+(?:of\s+|the\s+|de\s+)?[A-Z0-9][\w.'’&-]*)*)/);
  const name = match?.[1]?.trim();
  return name && name.split(/\s+/).length >= 1 && !/^(?:It|That|This|They|He|She|The|You|We|I)$/.test(name) ? name : undefined;
}

export function followSearchPlan(input: { title?: string; question: string; queries: string[]; subject: string; lead?: string }): { query: string; fanout: string[]; added?: string; subject?: string } {
  const title = input.title?.replace(/\s+/g, ' ').trim() ?? '';
  const asked = input.question.replace(/^(?:and|so)\s+/i, '').trim();
  const sides = uniqueSides(compareSides(title).map((side) => cleanSideName(side)));
  // "That's wrong, it's the Empire State Building, right?" answered "No — One World Trade Center is still the tallest":
  // "When did it open?" is about the building the card affirmed, not the one the person proposed and the card rejected.
  const affirmed = SINGULAR_POINTER.test(asked) ? rejectionAffirms(input.lead ?? '') : undefined;
  if (affirmed && !sides.some((side) => sameObject(side, affirmed) || sideNamed(affirmed, side))) {
    const query = asked.replace(/\bit's\b/i, `${affirmed} is`).replace(SINGULAR_POINTER, affirmed).replace(/[?.!]+$/, '');
    return { query, fanout: [], subject: affirmed };
  }
  // "When did it open?" on a card whose lead settles one side ("No — One WTC is still the tallest") is about that side.
  const pointed = sides.length >= 2 && SINGULAR_POINTER.test(asked) && !sides.some((side) => sideNamed(asked, side))
    ? sides.filter((side) => sideNamed(input.lead ?? '', side))
    : [];
  if (pointed.length === 1) {
    const side = pointed[0]!;
    const query = asked.replace(/\bit's\b/i, `${side} is`).replace(SINGULAR_POINTER, side).replace(/[?.!]+$/, '');
    return { query, fanout: [], subject: side };
  }
  if (sides.length >= 2) {
    const intro = objectPhrase(asked, sides);
    if (intro?.kind === 'switch') return { query: intro.name, fanout: [intro.name], added: intro.name };
    const next = intro ? [...sides, intro.name] : sides;
    const attribute = intro ? '' : attributeWords(asked, sides);
    const query = next.join(' vs ');
    const fanout = intro ? [intro.name, ...sides] : next.map((side) => (attribute ? `${side} ${attribute}` : side));
    return { query, fanout, added: intro?.name };
  }
  // "What about Google?" on "AI News Today" asks the card's question about Google: "Google AI News Today", not "Google".
  const swapped = asked.match(/^(?:what|how)\s+about\s+(.+?)[?.!]*$/i)?.[1]?.trim();
  if (swapped && title && !title.toLowerCase().includes(swapped.toLowerCase())) {
    const query = `${swapped} ${title}`;
    return { query, fanout: input.queries.map(withoutLeadVerb).filter((item) => item.toLowerCase() !== query.toLowerCase()).slice(0, 2), subject: swapped };
  }
  // "What is Cooper Flagg?" names its own subject: the card's subject is not glued onto it. A place after a
  // preposition ("with sales tax in New York City") qualifies the card's subject, and "it" points back at it.
  const named = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.exec(asked.replace(/^[A-Z][a-z]*\b/, (word) => ' '.repeat(word.length)));
  const before = named ? asked.slice(0, named.index).trim().split(/\s+/).pop()?.toLowerCase() ?? '' : '';
  const ownName = named && !POINTER.test(asked) && !/^(?:in|at|from|to|for|near|of|on|by|with|vs|versus|than)$/.test(before) ? named[0] : undefined;
  if (ownName && !title.toLowerCase().includes(ownName.toLowerCase())) {
    return { query: withoutLeadVerb(input.queries[0] ?? asked), fanout: input.queries.slice(1).map(withoutLeadVerb), subject: ownName };
  }
  const place = placeOnScreen(title) || input.subject;
  const written = withoutLeadVerb(input.queries[0] ?? asked);
  const fanout = input.queries.slice(1).map(withoutLeadVerb);
  // "And for a visitor from Ohio?" on "Met Admission" asks the card's whole question again with a new qualifier:
  // the fact asked ("Admission") stays in the search, not only the place.
  if (QUALIFIER_LEAD.test(asked) && title && !mentionsPlace(written, place)) return { query: `${title} ${asked.replace(/[?.!]+$/, '')}`, fanout };
  // "When did it open?" names the place in the pronoun's spot, not glued in front. A judge's search that already
  // names it in other words ("Met Museum admission" for "NY State Met") stays.
  const query = place && !mentionsPlace(written, place) ? fallbackQuery(withoutLeadVerb(asked), place) : written;
  return { query, fanout };
}

export function parseDecision(raw: unknown): TurnDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as { action?: unknown; queries?: unknown; subject?: unknown };
  const action = row.action === 'search' || row.action === 'answer' || row.action === 'calculate' ? row.action : undefined;
  if (!action) return undefined;
  const queries = (Array.isArray(row.queries) ? row.queries : [])
    .filter((query): query is string => typeof query === 'string' && query.trim().length > 1)
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .slice(0, 4);
  const subject = typeof row.subject === 'string' ? row.subject.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (action === 'search' && !queries.length) return undefined;
  return { action, queries: action === 'search' ? queries : [], subject };
}

export function parseSourceDecision(raw: unknown): SourceDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as { enough?: unknown; query?: unknown };
  if (typeof row.enough !== 'boolean') return undefined;
  const query = typeof row.query === 'string' ? row.query.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
  if (!row.enough && query.length < 2) return undefined;
  return { enough: row.enough, query: row.enough ? '' : query };
}

/**
 * The search for a follow-up when the turn judge did not answer in time: the pronoun becomes the subject on screen
 * ("When did it open?" → "When did One World Trade Center open"). A question that already names it is searched as is.
 */
export function fallbackQuery(question: string, subject: string): string {
  const asked = question.trim().replace(/[?!.]+$/, '');
  const name = subject.trim();
  if (!name) return asked;
  if (asked.toLowerCase().includes(name.toLowerCase())) return asked;
  // "Webb's" is already possessive: "its main mirror" is "Webb's main mirror", not "Webb's's".
  if (/\bits\b/i.test(asked) && !/\b(?:it|it's)\b/i.test(asked)) return asked.replace(/\bits\b/i, /['’]s$/i.test(name) ? name : `${name}'s`);
  if (/\bit's\b/i.test(asked)) return asked.replace(/\bit's\b/i, `${name} is`);
  if (/\b(?:it|he|she|they|them|him|her)\b/i.test(asked)) return asked.replace(/\b(?:it|he|she|they|them|him|her)\b/i, name);
  return `${name} ${asked}`;
}

async function ask<T>(env: Env, system: string, user: string, ms: number): Promise<T | undefined> {
  if (!hasLlm(env)) return undefined;
  const call = llmJson<T>(env, system, user, 180).catch(() => undefined);
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
  return Promise.race([call, timeout]);
}

export async function judgeTurn(env: Env, input: {
  question: string;
  original: string;
  context?: string;
  title?: string;
  card?: string;
  sources?: string;
}): Promise<TurnDecision | undefined> {
  const user = [
    `Conversation started with: ${input.original}`,
    input.title ? `Card on screen: ${input.title}` : '',
    input.card ? `Card text:\n${input.card.slice(0, 900)}` : '',
    input.context ? `Conversation:\n${input.context.slice(0, 1200)}` : '',
    input.sources ? `Sources already in hand:\n${input.sources.slice(0, 900)}` : '',
    `Follow-up: ${input.question}`,
  ].filter(Boolean).join('\n');
  return parseDecision(await ask<unknown>(env, TURN, user, 1200));
}

export async function judgeSources(env: Env, query: string, snippets: string): Promise<SourceDecision | undefined> {
  const user = `Question: ${query}\n\nSnippets:\n${snippets.slice(0, 1400)}`;
  return parseSourceDecision(await ask<unknown>(env, SOURCES, user, 1000));
}
