import { askFacet, personName } from '../shared/askAbout';
import type { CardNode, FollowupMode, LayoutPlan } from '../shared/card';
import { quoteAsk } from '../shared/quoteAsk';
import { isBlockPage } from './blockPage';
import { isCalculationAsk } from './calculate';
import { repeatsCallout } from './chips';
import { isPersonAsk, personSubject } from './entity';
import { compareSides, heuristicPattern, patternById, skeletonCard } from './patterns';

const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]*/i;

/** An action about our own blocked fetch, not about what the person asked. */
const LEAK = /\b(unblock|robots\.txt|ip address|crawler|automated fetches|eprint-abuse|been blocked|you have been redirected)\b/i;

const PRONOUN = /\b(it|its|this|that|these|those|he|she|him|her|they|them|their|one|cheaper|other)\b/i;

const FILLER = new Set(['the', 'and', 'for', 'with', 'about', 'from', 'this', 'that', 'what', 'how', 'who', 'are', 'was', 'were', 'you', 'your', 'into', 'onto']);

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

const PRICE_CUE = /\b(?:price|prices|quote|quotes|stock|shares?|chart|charts|trading|worth|how much)\b|\$[A-Za-z]{1,5}\b/i;

/**
 * A price or stock follow-up, searched with the subject already on screen when the question
 * does not name the instrument itself. Undefined when this is not a market-price ask.
 */
export function quoteFollowQuery(question: string, subjects: readonly string[]): string | undefined {
  const q = question.trim();
  if (!q) return undefined;
  if (quoteAsk(q)) return q;
  if (!PRICE_CUE.test(q)) return undefined;
  for (const subject of subjects) {
    const head = subject.trim().split(/\s+/).slice(0, 10).join(' ');
    if (!head) continue;
    const combined = `${head} ${q}`.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (quoteAsk(combined)) return combined;
  }
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
