import { askFacet, personName } from '../shared/askAbout';
import type { CardNode, FollowupMode, LayoutPlan } from '../shared/card';
import { quoteAsk, QUOTE_MAX } from '../shared/quoteAsk';
import { isBlockPage } from './blockPage';
import { isCalculationAsk } from './calculate';
import { repeatsCallout } from './chips';
import { isPersonAsk, personSubject } from './entity';
import { mentionsSide } from './compareAnswer';
import { compareSides, heuristicPattern, patternById, skeletonCard } from './patterns';

const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]*/i;

/** An action about our own blocked fetch, not about what the person asked. */
const LEAK = /\b(unblock|robots\.txt|ip address|crawler|automated fetches|eprint-abuse|been blocked|you have been redirected)\b/i;

const PRONOUN = /\b(it|its|this|that|these|those|he|she|him|her|they|them|their|one|cheaper|other)\b/i;

const FILLER = new Set(['the', 'and', 'for', 'with', 'about', 'from', 'this', 'that', 'what', 'how', 'who', 'are', 'was', 'were', 'you', 'your', 'into', 'onto']);

/** A capitalised token that starts a question, not a place or a business. */
const LEAD_NAME = new Set(['what', 'whats', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'which', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'if', 'tell', 'show', 'give', 'the', 'and', 'for', 'from', 'not',
  // A pushback or a pointer starts a sentence; it is not the name ("That is wrong, it's the Empire State Building").
  'that', 'this', 'these', 'those', 'it', 'its', 'there', 'here', 'yes', 'no', 'wrong', 'right', 'actually', 'also', 'but', 'okay', 'well', 'really', 'please']);

/**
 * One new word that asks about the thing already on screen ("floors", "deck").
 * A single word outside this set is a different subject ("tesla"). Several new words
 * stay with the subject unless one of them is a different proper name.
 */
const ASPECT = new Set([
  'floor', 'storey', 'storie', 'story', 'level', 'deck', 'observation', 'platform', 'gallery', 'gallerie',
  'view', 'viewing', 'visitor', 'visit', 'ticket', 'admission', 'hour', 'open', 'clos', 'close',
  'height', 'tall', 'high', 'elevation', 'spire', 'antenna', 'roof', 'top', 'base', 'inside', 'interior',
  'outside', 'exterior', 'built', 'build', 'year', 'date', 'address', 'locat', 'locate', 'location',
  'owner', 'architect', 'designer', 'design', 'engineer', 'elevator', 'lift', 'stair', 'step',
  'restaurant', 'food', 'shop', 'store', 'public', 'people', 'person', 'wide', 'width', 'area', 'size',
  'capacity', 'population', 'fee', 'cost', 'tax', 'rate', 'price', 'official', 'current', 'today',
  'photo', 'picture', 'image', 'history', 'fact', 'info', 'information', 'near', 'nearby', 'around',
  'within', 'meter', 'metre', 'feet', 'foot', 'mile', 'kilometer', 'kilometre', 'north', 'south', 'east',
  'west', 'call', 'name', 'known', 'show', 'tell', 'give', 'explain', 'mean', 'there', 'here', 'also',
  'still', 'just', 'only', 'above', 'below', 'under', 'over', 'part', 'section', 'lobby', 'entrance',
  'exit', 'tower', 'bridge', 'center', 'centre', 'plaza', 'park', 'museum', 'city', 'state', 'country',
  'county', 'schedule', 'schedul', 'adult', 'child', 'children', 'free', 'paid', 'site', 'page', 'phone',
  'number', 'square', 'glass', 'map', 'direction', 'parking', 'time', 'day', 'night', 'access', 'ground',
  'street', 'hall', 'gate', 'door', 'window', 'overlook', 'lookout', 'terrace', 'keep',
]);

const NAME_WORD = /^(?:[A-Z]{2,}|[A-Z][a-zA-Z0-9'’.-]{2,})$/;

const contentWords = (text: string) => new Set(
  text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w)),
);

/** "Draft the unblock email", "write a short apology": the answer is a piece of writing, not a new web search. */
export function isWritingAsk(question: string): boolean {
  const q = question.trim();
  return /^(write|draft|rewrite|reword|compose|proofread|polish)\b/i.test(q)
    || /\b(draft|write|compose)\b.{0,40}\b(email|e-mail|letter|message|post|bio|caption|note)\b/i.test(q);
}

/**
 * A follow-up that already says what to search ("How to use the IACR API"): rewriting it is what turned
 * "Draft the unblock email" into "Takes Two, 2a06:98c0:…". Pronouns ("explain it") still need a rewrite.
 */
export function standsAlone(question: string): boolean {
  const words = question.trim().split(/\s+/);
  return words.length >= 5 && !PRONOUN.test(question);
}

const ABOUT_SWAP = /^(?:what|how)\s+about\b/i;
/** "which …" and "who scored …" ask about the set already on screen. "who is Ada Lovelace" does not. */
const ELLIPTICAL = /^(?:which\b|who\b(?!\s+(?:is|are|was|were)\b))/i;
/**
 * Words that ask for an attribute of the subject already on screen. They are not a new subject
 * ("what's the price", "how many calories"), so the follow-up keeps that subject.
 */
const ATTRIBUTE = new Set([
  'price', 'prices', 'cost', 'costs', 'weight', 'weights', 'battery', 'batteries', 'calorie', 'calories',
  'height', 'size', 'storage', 'speed', 'range', 'score', 'scores', 'stat', 'stats', 'news', 'schedule',
  'highlight', 'highlights', 'stock', 'share', 'shares', 'chart', 'charts', 'quote', 'quotes', 'worth',
  'trading', 'today', 'latest', 'current', 'live', 'much', 'many', 'long', 'best', 'better', 'more', 'most',
  'less', 'least', 'can', 'could', 'would', 'should', 'does', 'did', 'have', 'has', 'will', 'just', 'also',
  'tell', 'show', 'give', 'make', 'need', 'want', 'like', 'some', 'any', 'why', 'when', 'where', 'which',
  'use', 'using', 'used', 'get', 'got', 'new', 'old', 'next', 'last', 'first', 'good',
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function contentStems(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !FILLER.has(word)).map(stem);
}

const COVERED_SKIP = new Set([
  'what', 'when', 'where', 'which', 'how', 'long', 'much', 'many', 'tell', 'show', 'give', 'about', 'with',
  'from', 'that', 'this', 'have', 'will', 'would', 'could', 'should', 'your', 'they', 'them', 'their',
  'there', 'into', 'over', 'than', 'then', 'only', 'very', 'really', 'please', 'come', 'comes', 'coming',
  'does', 'just', 'also', 'good', 'best', 'better', 'more', 'most', 'less', 'least', 'make', 'need', 'want',
  'like', 'some', 'used', 'using',
]);

/**
 * The pages and card already on screen state the fact this follow-up asks.
 * A question with no new fact ("tell me more") is covered. "Battery" is not covered
 * until that word is in the sources.
 */
export function sourcesCover(question: string, subject: string, corpus: string): boolean {
  const skip = new Set(subject.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  for (const word of COVERED_SKIP) skip.add(word);
  const facts = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !skip.has(word));
  if (!facts.length) return true;
  const hay = corpus.toLowerCase();
  return facts.every((word) => {
    const bare = word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
    return hay.includes(word) || hay.includes(bare);
  });
}

/**
 * A follow-up that names something the card does not, and does not point back at that card.
 * It is searched as written. A related turn (a pronoun, "which", a shared word, or only an
 * attribute such as price) keeps the subject already on screen.
 */
export function ownQuestion(question: string, covered: string): boolean {
  const q = question.trim();
  if (!q || isWritingAsk(q) || isCalculationAsk(q)) return false;
  if (PRONOUN.test(q) || ABOUT_SWAP.test(q) || ELLIPTICAL.test(q) || /\b(?:instead|rather)\b/i.test(q)) return false;
  const asked = contentStems(q);
  const subject = new Set(contentStems(covered));
  if (asked.some((word) => subject.has(word))) return false;
  return asked.some((word) => !ATTRIBUTE.has(word) && !subject.has(word));
}

/** "Of those" / "drop any" / "keep only" classifies the items already listed. It is not a new search. */
const CLASSIFY = /\b(?:of those|of these|which of the ones|drop any|keep only)\b/i;

function sharesCard(text: string, covered: string): boolean {
  const words = contentStems(text).filter((word) => word.length >= 4 && !ATTRIBUTE.has(word));
  if (words.length < 2) return false;
  const card = covered.toLowerCase();
  const hits = words.filter((word) => card.includes(word)).length;
  return hits >= 2 && hits / words.length >= 0.34;
}

/**
 * The follow-up points at the card already on screen: it explains a sentence from that card,
 * or it is a short question that points back ("explain this move"). A new subject does not.
 */
export function pointsAtCard(question: string, covered: string): boolean {
  const q = question.trim();
  if (!q || isWritingAsk(q) || isCalculationAsk(q) || CLASSIFY.test(q)) return false;
  const quoted = [...q.matchAll(/["“]([^"”]{8,})/g)].map((match) => match[1]!);
  if (quoted.some((part) => sharesCard(part, covered))) return true;
  if (/^explain\b/i.test(q)) {
    const rest = q.replace(/^explain\b[:\s-]*/i, '').replace(/^["“]+|["”]+$/g, '').trim();
    if (!rest || PRONOUN.test(rest) || sharesCard(rest, covered)) return true;
  }
  if (PRONOUN.test(q) && q.split(/\s+/).length <= 8) return true;
  return false;
}

/** A short title already on screen. A pronoun question ("how tall is it?") is not the subject. A long sentence still yields the proper name it opens with. */
export function screenSubject(title: string | undefined, original: string): string {
  const pick = (value: string) => {
    const text = value.trim();
    if (!text || text.length > 60 || text.split(/\s+/).length > 6) return '';
    if (/\b(it|its|this|that|they|them)\b/i.test(text)) return '';
    return text;
  };
  return pick(title ?? '') || pick(original) || namedSubject(title ?? '') || namedSubject(original);
}

/** The first run of capitalised words, skipping a leading question word. "When did North Pier open?" → "North Pier". */
function namedSubject(text: string): string {
  const words = text.replace(/[“”"'’]/g, ' ').split(/\s+/).filter(Boolean);
  const name: string[] = [];
  for (const raw of words) {
    const bare = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    const cap = NAME_WORD.test(bare) && !LEAD_NAME.has(bare.toLowerCase());
    if (!name.length) {
      if (cap) name.push(bare);
      continue;
    }
    if (cap) name.push(bare);
    else break;
  }
  return name.join(' ');
}

function bareWord(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

/** A capitalised place or business in `text` that `allowed` does not already name. */
export function foreignName(text: string, allowed: string): boolean {
  const allow = allowed.toLowerCase();
  const words = text.replace(/[“”"'’]/g, ' ').split(/\s+/).filter(Boolean);
  return words.some((raw, index) => {
    const bare = bareWord(raw);
    if (!NAME_WORD.test(bare)) return false;
    if (index === 0 && LEAD_NAME.has(bare.toLowerCase())) return false;
    return !allow.includes(bare.toLowerCase());
  });
}

/** Drops capitalised names `allowed` does not contain. An aspect word the person did not capitalise ("open") drops too. */
export function stripForeignNames(query: string, allowed: string, typed = ''): string {
  const allow = allowed.toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const kept = words.filter((raw, index) => {
    const bare = bareWord(raw);
    if (!NAME_WORD.test(bare)) return true;
    if (index === 0 && LEAD_NAME.has(bare.toLowerCase())) return true;
    if (!allow.includes(bare.toLowerCase())) return false;
    if (ASPECT.has(stem(bare.toLowerCase())) && typed && !typed.includes(bare)) return false;
    return true;
  });
  const out = kept.join(' ').replace(/\s+/g, ' ').trim();
  return out || query.trim();
}

/**
 * The follow-up names something other than the subject on screen: a proper name that is not
 * on the card, a "what is X" lookup, or one new word that is not an attribute of that subject.
 */
function namesNewTopic(question: string, allowed: string): boolean {
  const known = new Set(contentStems(allowed));
  const lookup = question.trim().match(/^(?:what|who)\s+(?:is|are|was|were)\s+(?!the\b|its\b|their\b|this\b|that\b)(.+)$/i);
  if (lookup) {
    const stems = contentStems(lookup[1] ?? '');
    if (stems.some((word) => word.length >= 4 && !known.has(word) && !ATTRIBUTE.has(word))) return true;
  }
  const novel = contentStems(question).filter((word) => word.length >= 4 && !known.has(word) && !ATTRIBUTE.has(word));
  return novel.length === 1 && !ASPECT.has(novel[0]!);
}

/**
 * A later turn whose new words are still about the subject on screen.
 * The search is those words plus that subject. Undefined when the follow-up names a different thing.
 */
export function sameSubjectQuery(question: string, subject: string, covered: string): string | undefined {
  const name = subject.trim();
  const q = question.trim();
  if (!name || !q || isWritingAsk(q) || isCalculationAsk(q) || asksToCompare(q)) return undefined;
  const allowed = `${name}\n${covered}`;
  if (foreignName(q, allowed) || namesNewTopic(q, allowed)) return undefined;
  // A price follow-up still goes through the quote check, which keeps the chart.
  if (quoteFollowQuery(q, [name])) return undefined;
  if (q.toLowerCase().includes(name.toLowerCase())) return undefined;
  return `${name} ${q}`.replace(/\s+/g, ' ').trim();
}

/**
 * The search for a follow-up in this chain. Names that are not in the question or the subject
 * drop out. The subject stays in front unless the question itself names a different thing.
 */
export function lockChainQuery(question: string, rewritten: string, subject: string, anchor: string): string {
  const name = subject.trim();
  const subjectText = `${anchor}\n${name}`;
  const switched = foreignName(question, subjectText) || namesNewTopic(question, subjectText);
  const cleaned = stripForeignNames(rewritten.trim() || question.trim(), switched ? question : `${question}\n${subjectText}`, question);
  if (switched || !name) return cleaned;
  if (cleaned.toLowerCase().includes(name.toLowerCase())) return cleaned;
  return `${name} ${cleaned}`.replace(/\s+/g, ' ').trim();
}

/**
 * The follow-up's own words, with the subject already on screen when the follow-up points at that card.
 * Undefined when the follow-up is its own question.
 */
export function cardFollowQuery(question: string, subject: string, covered: string): string | undefined {
  const q = question.trim();
  if (!pointsAtCard(q, covered)) return undefined;
  const body = q.replace(/^(?:explain|go deeper on)\b[:\s-]*/i, '').replace(/^["“]+|["”]+$/g, '').replace(/\s+/g, ' ').trim();
  const words = body || q;
  const name = subject.trim();
  if (!name || words.toLowerCase().includes(name.toLowerCase())) return words;
  return `${name} ${words}`.replace(/\s+/g, ' ').trim();
}

/**
 * The search for a follow-up that points at the card already on screen.
 * An explanation of a sentence on that card is searched as those words plus the subject.
 * A price rewrite is used only when it still names that subject, so a false company
 * ("Explain shares fell" read as a company named Explain) cannot drop the one on screen.
 * Undefined when the follow-up is its own question.
 */
export function followSearchQuery(question: string, subject: string, covered: string, subjects: readonly string[]): string | undefined {
  if (!pointsAtCard(question, covered)) return undefined;
  const pointed = cardFollowQuery(question, subject, covered);
  if (/^(?:explain|go deeper on)\b/i.test(question.trim()) && pointed) return pointed;
  const named = quoteFollowQuery(question, subjects);
  const name = subject.trim().toLowerCase();
  if (named && (!name || named.toLowerCase().includes(name))) return named;
  return pointed ?? named;
}

const PRICE_CUE = /\b(?:price|prices|quote|quotes|stock|shares?|chart|charts|trading|worth|how much)\b|\$[A-Za-z]{1,5}\b/i;

/**
 * A price or stock follow-up, searched with the subject already on screen when the question
 * does not name the instrument itself. Undefined when this is not a market-price ask.
 */
export function quoteFollowQuery(question: string, subjects: readonly string[]): string | undefined {
  const q = question.trim();
  if (!q) return undefined;
  if (quoteAsk(q)) return q;
  // A long question is the question. Chopping it so a ticker check would accept the stub
  // searched that stub ("… who g") and charted whatever symbol survived inside it.
  if (!PRICE_CUE.test(q) || q.length > QUOTE_MAX) return undefined;
  for (const subject of subjects) {
    let words = subject.trim().split(/\s+/).filter(Boolean).slice(0, 10);
    while (words.length) {
      const combined = `${words.join(' ')} ${q}`.replace(/\s+/g, ' ').trim();
      if (combined.length <= QUOTE_MAX && quoteAsk(combined)) return combined;
      words = words.slice(0, -1);
    }
  }
  return undefined;
}

/**
 * A follow-up on a comparison that names one product, or a possessive that glued both names
 * into one token ("What is Northwatch Glowband's glowband?"). The search is that product.
 */
export function comparisonFollow(question: string, original: string): string | undefined {
  const sides = compareSides(original);
  if (sides.length < 2) return undefined;
  const q = question.trim();
  const owned = q.match(/^(?:what|who)\s+(?:is|are)\s+(.+?)['’]s\s+(.+?)\s*\??$/i);
  if (owned) {
    const owner = owned[1] ?? '';
    const object = (owned[2] ?? '').replace(/[?.!]+$/, '').trim();
    const inOwner = sides.filter((side) => mentionsSide(side, owner));
    if (inOwner.length >= 2 && object) {
      const asked = sides.find((side) => mentionsSide(side, object));
      return `What is ${asked ?? object}?`;
    }
  }
  const named = sides.filter((side) => mentionsSide(side, q));
  if (named.length === 1) return q;
  return undefined;
}

/**
 * A follow-up that names the things to compare ("A vs B vs C") needs its own search.
 * "Compare this with that" still depends on the card on screen, so it stays a conversation turn.
 */
export function asksToCompare(question: string): boolean {
  return compareSides(question).length >= 2 && !PRONOUN.test(question);
}

/**
 * "Which one has better battery life?" after "iPhone 17 vs Pixel 10" is that comparison's
 * battery, not a fresh search that can wander off to other phones. Skips the rewriter.
 */
export function anchoredFollowup(original: string, question: string): string | undefined {
  if (!/\b(which|what|how)\b/i.test(question)) return undefined;
  if (!/\b(one|it|they|them|either|better|worse|more|less)\b/i.test(question)) return undefined;
  const sides = compareSides(original);
  if (sides.length < 2) return undefined;
  const attr = question
    .replace(/\b(which|one|of them|has|have|is|are|a|the|better|worse|more|less|it|they|them)\b/gi, ' ')
    .replace(/[?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const vs = sides.join(' vs ');
  return attr ? `${vs} ${attr}` : vs;
}

/**
 * "What is Priya Natarajan?" is a person lookup. The name is the search.
 * A longer question ("What is Priya Natarajan's college?") keeps the person's own words.
 */
export function personQuestion(question: string): string {
  const q = question.trim();
  const m = q.match(/^(?:what|who|why)\s+(?:is|are)\s+(.+?)\s*\??$/i);
  if (!m) return q;
  const subject = m[1].trim().replace(/[?.!]+$/, '');
  return personName(subject) ? subject : q;
}

/**
 * A follow-up that looks a person up needs its own search. Answering "What is Priya Natarajan?"
 * from the card already on screen was the miss. A definition ("What is photosynthesis?") stays
 * with the planner: general knowledge is often the right, faster answer. Pronouns and writing stay a conversation turn.
 */
export function needsOwnSearch(question: string, covered: string): boolean {
  if (isWritingAsk(question)) return false;
  const q = question.trim();
  if (PRONOUN.test(q)) return false;
  const asked = personQuestion(q);
  if (!isPersonAsk(asked)) return false;
  const name = personSubject(asked);
  if (!name || !personName(name)) return false;
  return !covered.toLowerCase().includes(name.toLowerCase());
}

/**
 * The rewritten query, or the person's own words when the rewrite dropped them or picked up a ban notice.
 * "Draft the unblock email" shares nothing with "Takes Two, 2a06:…", so the email is what gets answered.
 */
export function faithfulQuery(question: string, rewritten: string): string {
  const next = rewritten.trim();
  if (!next) return question;
  if (IP.test(next)) return question;
  if (LEAK.test(next) && !LEAK.test(question)) return question;
  // "preseason highlights" rewritten as "… stats" kept the name and dropped the tap.
  const askedFor = askFacet(question);
  const rewrittenAs = askFacet(next);
  if (askedFor && rewrittenAs && askedFor !== rewrittenAs) return question;
  const asked = contentWords(question);
  const got = contentWords(next);
  const shared = [...asked].filter((w) => got.has(w) || [...got].some((g) => g.startsWith(w) || w.startsWith(g)));
  if (asked.size >= 2 && !PRONOUN.test(question) && shared.length === 0) return question;
  return next;
}

/** Ban notices and the server's address never reach a model: they were becoming the next search. */
export function scrubLeak(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isBlockPage(line) && !(LEAK.test(line) && IP.test(line)))
    .map((line) => line.replace(IP, '').replace(/[ \t]{2,}/g, ' ').trimEnd())
    .filter((line) => line.trim())
    .join('\n');
}

type Actions = Extract<CardNode, { type: 'actions' }>;

/** Drops next-step buttons about a blocked fetch ("Draft the unblock email"). Undefined when none remain. */
export function withoutLeakActions(actions: Actions): Actions | undefined {
  const items = actions.items.filter((item) => !LEAK.test(`${item.label} ${item.query}`));
  if (!items.length) return undefined;
  return items.length === actions.items.length ? actions : { ...actions, items };
}

/**
 * A region that restates a warning already on the card loses that warning and keeps its other content.
 * Undefined when the warning was all it had.
 */
export function withoutRepeatedCallouts(node: CardNode, shown: readonly CardNode[]): CardNode | undefined {
  if (repeatsCallout(node, shown)) return undefined;
  if (node.type === 'tabs') {
    const tabs = node.tabs.map((tab) => ({
      ...tab,
      children: tab.children.flatMap((child) => {
        const kept = withoutRepeatedCallouts(child, shown);
        return kept ? [kept] : [];
      }),
    })).filter((tab) => tab.children.length);
    if (!tabs.length) return undefined;
    return tabs.length === node.tabs.length && tabs.every((tab, i) => tab.children.length === node.tabs[i]!.children.length) ? node : { ...node, tabs };
  }
  if ('children' in node && Array.isArray(node.children)) {
    const children = node.children.flatMap((child) => {
      const kept = withoutRepeatedCallouts(child, shown);
      return kept ? [kept] : [];
    });
    if (!children.length) return undefined;
    if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
    return { ...node, children } as CardNode;
  }
  return node;
}

/** A layout decided from the question's own words, so a writing follow-up starts without waiting on the planner. */
export function quickPlan(query: string, mode: FollowupMode): LayoutPlan {
  const pattern = isWritingAsk(query) ? 'draft' : heuristicPattern(query);
  const picked = patternById(pattern);
  return {
    query,
    pattern,
    alternatives: [{ id: picked.id, label: picked.label, description: picked.description }],
    skeleton: skeletonCard(query, pattern),
    engine: 'heuristic',
    confidence: 0.6,
    depth: 'brief',
    readPages: false,
    mode,
    think: false,
    ms: 0,
  };
}

/** "crypto" next to cryptography papers means the field, not coins. */
export function cryptographyHint(query: string, rows: { title: string; snippet?: string; url: string }[]): string | undefined {
  if (!/\bcrypto\b/i.test(query) || /\b(cryptocurrency|bitcoin|ethereum|blockchain|coin|token|nft)\b/i.test(query)) return undefined;
  const blob = rows.slice(0, 8).map((r) => `${r.title} ${r.snippet ?? ''} ${r.url}`).join(' ').toLowerCase();
  const papers = (blob.match(/cryptograph|eprint|iacr|arxiv|proof/g) ?? []).length;
  const coins = (blob.match(/bitcoin|ethereum|blockchain|cryptocurrency|trading/g) ?? []).length;
  return papers > coins ? 'In this question "crypto" means cryptography, the field the sources are about, not cryptocurrency.' : undefined;
}
