import { hasLlm, llmJson } from './llm';
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
- action "answer" when the card and the sources already state the fact this turn asks. queries is empty.
- action "search" when they do not. queries is 1 or 2 web searches, the new words plus that subject, each 3-12 words. A comparison searches each product as its own name, never glued into one token. A variant (Pro, Plus, Max, Mini, Ultra) is a different product: search the exact model asked, not a different variant. A how-to, a requested quote, a live price, a tax, a fee, or a health question searches the official page for that subject.
- action "calculate" when they ask to split, multiply, or apply a rate or price already on the card. queries is empty. The figure on the card is the figure to use.
- Do not add a person, place, or business that the follow-up and the subject do not name.`;

const SOURCES = `You have a question and the first search snippets. Reply as JSON: {"enough":boolean,"query":string}
enough is true when these snippets can answer, including the steps of a how-to, the sentence of a requested quote, the official price or fee, or the health verdict.
enough is false when that fact, the official page, or one side of a comparison is missing. query is the one search that would find it, or "" when enough.
A variant (Pro, Plus, Max, Mini, Ultra) the question did not name is not the product asked.`;

export function parseDecision(raw: unknown): TurnDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as { action?: unknown; queries?: unknown; subject?: unknown };
  const action = row.action === 'search' || row.action === 'answer' || row.action === 'calculate' ? row.action : undefined;
  if (!action) return undefined;
  const queries = (Array.isArray(row.queries) ? row.queries : [])
    .filter((query): query is string => typeof query === 'string' && query.trim().length > 1)
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .slice(0, 2);
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
