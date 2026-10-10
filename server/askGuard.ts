import type { CardNode, FollowupMode, LayoutPlan } from '../shared/card';
import { isBlockPage } from './blockPage';
import { repeatsCallout } from './chips';
import { heuristicPattern, patternById, skeletonCard } from './patterns';

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
 * The rewritten query, or the person's own words when the rewrite dropped them or picked up a ban notice.
 * "Draft the unblock email" shares nothing with "Takes Two, 2a06:…", so the email is what gets answered.
 */
export function faithfulQuery(question: string, rewritten: string): string {
  const next = rewritten.trim();
  if (!next) return question;
  if (IP.test(next)) return question;
  if (LEAK.test(next) && !LEAK.test(question)) return question;
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
