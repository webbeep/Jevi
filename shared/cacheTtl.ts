import type { Freshness } from './types';

/**
 * How long a saved answer or search for a query stays good, judged from the query's own words
 * and its freshness window. Shared so the edge answer cache, the search cache and the device
 * snapshot all agree.
 */
export type CacheTier = 'live' | 'short' | 'medium' | 'long';

export const TIER_TTL_S: Record<CacheTier, number> = {
  live: 30,
  short: 5 * 60,
  medium: 3 * 3600,
  long: 24 * 3600,
};

/** Changes by the minute: scores in progress, quotes, weather. */
const LIVE = /\b(live (?:score|scores|stream|updates?|blog|coverage|results?|now)|(?:is|are|still|going|game|match) live|right now|at the moment|in[- ]game|play[- ]by[- ]play|breaking news|weather|forecast|temperature|traffic|stock price|share price|price of (?:bitcoin|btc|eth|ethereum|gold|oil)|trading at|exchange rate|bitcoin price|btc price|is .{1,30} (?:down|up|open|closed) (?:today|now)|outage|down right now)\b/i;
/** Changes within the hour: today's news, tonight's game, a stock move. */
const SHORT = /\b(today|today's|todays|tonight|tonight's|yesterday|this morning|this afternoon|this evening|just (?:announced|happened|released)|happening|scores?|final score|box score|injur(?:y|ies|ed)|injury report|news|headlines|latest|update[sd]?|stocks?|shares|earnings|dropp?(?:ed|ing)|plunge[sd]?|plunging|surg(?:e|ed|ing)|soar(?:ed|ing)?|rall(?:y|ied|ying)|crash(?:ed|ing)?|premarket|after hours)\b|(?:^|[^A-Za-z0-9])\$[A-Za-z]{1,5}\b/i;
/** Changes within the day: this week's slate, standings, upcoming dates. */
const MEDIUM = /\b(this week|this weekend|this month|recent(?:ly)?|current(?:ly)?|now|schedule|standings|rankings?|odds|lineup|roster|depth chart|trade rumors?|rumou?rs?|upcoming|next (?:game|match|episode|event|release)|release date|when (?:is|does|will)|preseason|playoffs?|season|box office|polls?|election|prices?|deals?|sales?|available|in stock|for sale)\b/i;

const RANK: Record<CacheTier, number> = { live: 3, short: 2, medium: 1, long: 0 };
const FROM_FRESHNESS: Partial<Record<Freshness, CacheTier>> = { day: 'short', week: 'medium' };

/** The tier for a query: the most time-sensitive of what its words and its freshness window say. */
export function cacheTier(query: string, freshness: Freshness | string = 'any'): CacheTier {
  const words: CacheTier = LIVE.test(query) ? 'live' : SHORT.test(query) ? 'short' : MEDIUM.test(query) ? 'medium' : 'long';
  const window = FROM_FRESHNESS[freshness as Freshness] ?? 'long';
  return RANK[words] >= RANK[window] ? words : window;
}

/** Seconds a saved answer or search for this query may be reused. */
export const cacheTtlS = (query: string, freshness: Freshness | string = 'any'): number => TIER_TTL_S[cacheTier(query, freshness)];
