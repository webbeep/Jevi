import type { AnswerCard, FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, ImageResult, SearchResponse } from '../shared/types';
import { rewriteQuery } from './ai';
import { designParallel, designStream } from './design';
import { collectPages } from './pages';
import { planLayout } from './plan';
import { type LateExtras, searchWithLate } from './search';
import type { Send } from './sse';
import type { Env } from './util';

export interface CardOnScreen {
  id: number;
  title: string;
  card?: AnswerCard;
}

export type StreamRequest =
  | { kind: 'search'; query: string; freshness: Freshness; context?: string }
  | {
      kind: 'design';
      query: string;
      pattern: string;
      depth: LayoutPlan['depth'];
      readPages: boolean;
      search: SearchResponse;
      simple?: boolean;
      followup?: FollowupContext;
      context?: string;
    }
  | { kind: 'followup'; question: string; original: string; search: SearchResponse; cards: CardOnScreen[]; context?: string };

interface DesignArgs {
  query: string;
  pattern: string;
  depth: LayoutPlan['depth'];
  readPages: boolean;
  search: SearchResponse;
  simple?: boolean;
  followup?: FollowupContext;
  context?: string;
  think?: boolean;
}

/** How many pages to read and how long to wait for them before designing. */
const pageBudget = (readPages: boolean) => (readPages ? { count: 5, need: 3, budgetMs: 2200 } : { count: 3, need: 2, budgetMs: 1000 });

async function design(send: Send, env: Env, req: DesignArgs, started: number, late?: Promise<LateExtras>) {
  // Conversation turns reason from what is already known; everything else reads pages first.
  const chat = req.followup?.mode === 'chat';
  const budget = chat ? { count: 3, need: 0, budgetMs: 0 } : pageBudget(req.readPages);
  const pages = await collectPages(req.search.results, env, budget, late);
  const fresh = pages.filter((p) => !req.search.results[p.n - 1]?.content);
  if (fresh.length) send('pages', fresh.map(({ n, url, text }) => ({ n, url, text })));

  // Page preview images and images from engines that answered late are often the most relevant ones.
  const lateImages = late ? await Promise.race([late.then((l) => l.images), new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 150))]) : [];
  const pageImgs = pages.filter((p) => p.image).map((p) => ({ url: p.url, thumb: p.image!, title: req.search.results[p.n - 1]?.title ?? '', source: req.search.results[p.n - 1]?.domain ?? '' }));
  const seen = new Set(req.search.images.map((i) => i.thumb));
  const extra = [...pageImgs, ...lateImages].filter((i) => i.thumb && !seen.has(i.thumb) && seen.add(i.thumb));
  if (extra.length) {
    req = { ...req, search: { ...req.search, images: [...extra, ...req.search.images].slice(0, 16) } };
    send('images', req.search.images);
  }

  send('designing', { pagesRead: pages.length, ms: Date.now() - started });
  // Follow-ups (small answers and redesigns) stay coherent in one call; full search cards are designed region by region in parallel.
  const designer = req.followup ? designStream : designParallel;
  const summary = await designer({ ...req, pages, context: req.context?.slice(0, 2500) }, env, {
    thinking: () => send('thinking', {}),
    layout: (regions) => send('layout', regions),
    head: (head) => send('head', head),
    node: (node, index) => send('node', { index, node }),
    followups: (items) => send('followups', items),
  });
  send('done', { ...summary, pagesRead: pages.length, ms: Date.now() - started });
}

async function searchAndDesign(send: Send, env: Env, query: string, freshness: Freshness, context: string | undefined, started: number) {
  const planned = planLayout(query, env).then((plan) => {
    send('plan', plan);
    return plan;
  });
  const { response: results, late } = await searchWithLate({ q: query, freshness, count: 20 }, env);
  send('search', results);
  if (!results.results.length) throw new Error('No results from any engine. Try rephrasing.');
  const plan = await planned;
  await design(send, env, { query, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: results, context }, started, late);
}

async function followup(send: Send, env: Env, req: Extract<StreamRequest, { kind: 'followup' }>, started: number) {
  const context = req.context?.slice(0, 2500);
  // Classify and speculatively rewrite at the same time; the rewrite is only used if Jev says a new search is needed.
  const rewritten = rewriteQuery(req.original, req.question, env, context).catch(() => req.question);
  const plan = await planLayout(req.question, env, { original: req.original, cards: req.cards.map(({ id, title }) => ({ id, title })), context });
  send('plan', plan);

  const mode = plan.mode ?? 'chat';
  switch (mode) {
    case 'search': {
      const query = await rewritten;
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', context, started);
      return;
    }
    case 'refine': {
      const target = req.cards.find((c) => c.id === plan.target && c.card) ?? [...req.cards].reverse().find((c) => c.card);
      if (target?.card) {
        send('target', { id: target.id });
        await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'refine', question: req.question, baseCard: target.card }, context }, started);
        return;
      }
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'chat', question: req.question }, context }, started);
      return;
    }
    case 'answer':
    case 'chat':
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: req.search, followup: { mode, question: req.question }, context, think: mode === 'chat' && plan.think }, started);
      return;
    default: {
      const unreachable: never = mode;
      throw new Error(`Unknown follow-up mode ${unreachable}`);
    }
  }
}

export async function runStream(req: StreamRequest, env: Env, send: Send): Promise<void> {
  const started = Date.now();
  switch (req.kind) {
    case 'search':
      await searchAndDesign(send, env, req.query, req.freshness, req.context, started);
      return;
    case 'design':
      await design(send, env, req, started);
      return;
    case 'followup':
      await followup(send, env, req, started);
      return;
    default: {
      const unreachable: never = req;
      throw new Error(`Unknown stream request ${JSON.stringify(unreachable)}`);
    }
  }
}
