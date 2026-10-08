import type { CallLedger } from './budget';

/**
 * Intent router. `quick`: news, sports, shopping and short lookups get one engine call (plus at most one
 * understood rewrite) on the Serper → LangSearch → Wikipedia chain. `deep`: research, compare and multi-part
 * questions run the literal search plus two rewrites in parallel on the first live engine, then ground on
 * 3–5 page reads. Exa is the capped last resort on both routes (see DEFAULT_ORDER / DEFAULT_CAPS).
 * Server-side only: the route and cost go to logs, never to the client.
 */
export type Route = 'quick' | 'deep';

const DEEP_WORDS = /\b(compare|comparison|compared|comparing|difference between|differences between|pros and cons|research|in[- ]depth|deep dive|analy[sz]e|analysis|explain (?:why|how)|why (?:do|does|did|is|are|was|were)|how (?:does|do|did) .{2,60} work|history of|impact of|trade-?offs?|evaluate|overview of|guide to|step[- ]by[- ]step|literature|studies on|evidence for)\b/i;
const VERSUS = /\b(?:vs\.?|versus)\b/i;
/** A "vs" in a game, score or news question is a quick lookup, not a comparison. */
const LOOKUP = /\b(score|scores|game|match|tonight|today|yesterday|live|highlights|odds|preseason|playoffs?|standings|schedule|news|headlines|price|prices|deal|deals|buy|cheapest|under \$?\d+)\b/i;

export function routeOf(query: string): Route {
  const q = query.trim();
  if (DEEP_WORDS.test(q)) return 'deep';
  if (VERSUS.test(q) && !LOOKUP.test(q)) return 'deep';
  // Multi-part: several questions, or one long question with clauses.
  if ((q.match(/\?/g)?.length ?? 0) >= 2) return 'deep';
  if (q.split(/\s+/).length >= 16 && /[;,]| and (?:also|then|how|why|what)\b/i.test(q)) return 'deep';
  return 'quick';
}

/** Rewrites each route may spend: quick keeps the call count low, deep fills the 3-call cap. */
export const routeExtras = (route: Route, extras: string[]) => (route === 'deep' ? extras.slice(0, 2) : extras.slice(0, 1));

/** Pages read before designing. Deep reads 3–5 pages with ~4s per page. */
export const DEEP_PAGES = { count: 5, need: 3, budgetMs: 4000 } as const;

/** Rough list prices in USD per call (server log only; free tiers count as list price, keyless as 0). */
const COST_USD: Record<string, number> = {
  serper: 0.001,
  langsearch: 0,
  exa: 0.005,
  tavily: 0.008,
  firecrawl: 0.0053,
  wikipedia: 0,
  backup: 0,
  social: 0,
  jina: 0.0002,
  keyless: 0,
  direct: 0,
};

export function estimateCost(ledger: CallLedger): { calls: number; costUsd: number } {
  let calls = 0;
  let cost = 0;
  for (const [name, n] of Object.entries(ledger.search)) {
    calls += n;
    cost += n * (COST_USD[name] ?? 0);
  }
  for (const [name, n] of Object.entries(ledger.pages)) cost += n * (COST_USD[name] ?? 0);
  return { calls, costUsd: Math.round(cost * 10000) / 10000 };
}
