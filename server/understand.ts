import type { Freshness, SearchResponse } from '../shared/types';
import { diversify } from './diversify';
import { hasLlm, llmJson } from './llm';
import { type LateExtras, normalizeUrl } from './search';
import type { Env } from './util';

export interface Understanding {
  /** One sentence: what the person wants to see. */
  intent: string;
  /** Web searches that find it, best first. */
  queries: string[];
  freshness: Freshness;
}

const FRESHNESS = new Set<Freshness>(['any', 'day', 'week', 'month', 'year']);

const SYSTEM = `You read what someone typed into a search box the way a thoughtful person would, work out what they actually want, and write the web searches that find it.
Reply as JSON: {"intent": string, "queries": string[], "freshness": "day"|"week"|"month"|"year"|"any"}
- intent: one sentence naming what they want to see, e.g. "A short summary of today's top news stories."
- queries: 1-3 web search queries, best first, 3-10 words each. Spell out what the words imply: "news tldr today" wants today's top headlines summarised, not a site or channel called TLDR, so search "top news headlines <today's date>". When they mean now (today, latest, this week, current, live, score, price), name the date, month or year. Keep the literal text as a query only when it already finds the answer (names, products, exact phrases).
- freshness: how recent results must be; "day" for today's news, scores or prices; "any" for timeless things.
- Never add facts or guesses about the answer itself.`;

/** Reads the intent behind a query; falls back to nothing (the literal search alone) when slow or unavailable. */
export async function understand(query: string, env: Env, context?: string, timeoutMs = 2500): Promise<Understanding | undefined> {
  if (!hasLlm(env)) return undefined;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const call = llmJson<Partial<Understanding>>(env, SYSTEM, `Today is ${today}.\n${context ? `Conversation so far:\n${context.slice(0, 1500)}\n` : ''}Typed: ${query}`, 160);
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  const out = await Promise.race([call.catch(() => undefined), timeout]);
  if (!out || typeof out.intent !== 'string') return undefined;
  const queries = (Array.isArray(out.queries) ? out.queries : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 1)
    .map((q) => q.trim().slice(0, 120))
    .slice(0, 3);
  return { intent: out.intent.trim().slice(0, 200), queries, freshness: FRESHNESS.has(out.freshness as Freshness) ? (out.freshness as Freshness) : 'any' };
}

const same = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, ' ').trim() === b.toLowerCase().replace(/\W+/g, ' ').trim();

/** Searches that add something beyond the literal query. */
export const extraQueries = (query: string, u: Understanding | undefined) => (u?.queries ?? []).filter((q) => !same(q, query)).slice(0, 2);

/**
 * Merges the intended searches with the literal one: results interleaved by rank across the intended
 * searches come first; the literal search leads only when Jev kept it as a query. The merged list is
 * then diversified (see diversify.ts): a site the person named first, at most 2 places per other domain.
 */
export function mergeSearches(query: string, literal: SearchResponse, intended: SearchResponse[], keepLiteral: boolean, max = 20): SearchResponse {
  const lead = keepLiteral ? [literal, ...intended] : intended;
  const byUrl = new Map<string, SearchResponse['results'][number]>();
  const add = (r: SearchResponse['results'][number]) => {
    const key = normalizeUrl(r.url);
    const seen = byUrl.get(key);
    if (seen) seen.engines = [...new Set([...seen.engines, ...r.engines])];
    else byUrl.set(key, { ...r });
  };
  const longest = Math.max(0, ...lead.map((s) => s.results.length));
  for (let i = 0; i < longest; i++) lead.forEach((s) => s.results[i] && add(s.results[i]));
  if (!keepLiteral) literal.results.forEach(add);

  const all = [...lead, literal];
  const thumbs = new Set<string>();
  const discussions = new Set<string>();
  return {
    query,
    freshness: literal.freshness,
    results: diversify(query, [...byUrl.values()]).slice(0, max),
    images: all.flatMap((s) => s.images).filter((i) => !thumbs.has(i.thumb) && thumbs.add(i.thumb)).slice(0, 24),
    knowledge: all.find((s) => s.knowledge)?.knowledge,
    discussions: all.flatMap((s) => s.discussions).filter((d) => !discussions.has(d.url) && discussions.add(d.url)).slice(0, 8),
    engines: literal.engines,
  };
}

export async function mergeLate(lates: Promise<LateExtras>[]): Promise<LateExtras> {
  const all = await Promise.all(lates.map((l) => l.catch((): LateExtras => ({ content: new Map(), images: [] }))));
  return { content: new Map(all.flatMap((l) => [...l.content])), images: all.flatMap((l) => l.images) };
}
