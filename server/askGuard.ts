import { askFacet, personName } from '../shared/askAbout';
import type { CardNode, FollowupMode, LayoutPlan } from '../shared/card';
import { isBlockPage } from './blockPage';
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

/** A measurable attribute a follow-up asks about, and what a source that states it looks like. */
const SPECS: { asks: RegExp; states: RegExp }[] = [
  {
    asks: /\b(lightest|lighter|lightweight|heaviest|heavier|weighs?|weight)\b/i,
    states: /\bweigh(s|t|ing)?\b|\b\d+(?:\.\d+)?\s?(?:g|grams?|kg|oz|ounces?|lbs?|pounds?)\b/i,
  },
  { asks: /\bbattery\b|\blasts? longer\b/i, states: /\bbattery\b|\bmah\b|\b\d+\s?(?:hours?|hrs?|h)\b/i },
  {
    asks: /\b(price|prices|priced|cost|costs|cheap|cheaper|cheapest|expensive|pricier|affordable)\b/i,
    states: /[$€£¥₹]\s?\d|\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b|\bpric(e|es|ed|ing)\b|\bmsrp\b/i,
  },
  { asks: /\b(calories|calorie|kcal)\b/i, states: /\b(calories|calorie|kcal)\b/i },
];

/**
 * "Which is lightest for travel?" when none of the gathered sources states a weight: answering from
 * them can only say "not listed", so the follow-up searches for that attribute instead.
 */
export function missingSpec(question: string, rows: { title: string; snippet?: string; content?: string }[]): boolean {
  if (!rows.length || isWritingAsk(question)) return false;
  const asked = SPECS.filter((s) => s.asks.test(question));
  if (!asked.length) return false;
  const text = rows.map((r) => `${r.title} ${r.snippet ?? ''} ${r.content ?? ''}`).join('\n');
  return asked.some((s) => !s.states.test(text));
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
