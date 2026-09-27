import type { FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, ImageResult, SearchResponse } from '../shared/types';
import { designParallel, designStream } from './design';
import { collectPages } from './pages';
import { planLayout } from './plan';
import { type LateExtras, searchWithLate } from './search';
import type { Send } from './sse';
import type { Env } from './util';

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
    };

/** How many pages to read and how long to wait for them before designing. */
const pageBudget = (readPages: boolean) => (readPages ? { count: 5, need: 3, budgetMs: 2200 } : { count: 3, need: 2, budgetMs: 1000 });

async function design(
  send: Send,
  env: Env,
  req: { query: string; pattern: string; depth: LayoutPlan['depth']; readPages: boolean; search: SearchResponse; simple?: boolean; followup?: FollowupContext; context?: string },
  started: number,
  late?: Promise<LateExtras>,
) {
  const budget = pageBudget(req.readPages);
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
  const summary = await designer({ ...req, pages }, env, {
    layout: (regions) => send('layout', regions),
    head: (head) => send('head', head),
    node: (node, index) => send('node', { index, node }),
    followups: (items) => send('followups', items),
  });
  send('done', { ...summary, pagesRead: pages.length, ms: Date.now() - started });
}

export async function runStream(req: StreamRequest, env: Env, send: Send): Promise<void> {
  const started = Date.now();
  switch (req.kind) {
    case 'search': {
      const planned = planLayout(req.query, env).then((plan) => {
        send('plan', plan);
        return plan;
      });
      const { response: results, late } = await searchWithLate({ q: req.query, freshness: req.freshness, count: 20 }, env);
      send('search', results);
      if (!results.results.length) throw new Error('No results from any engine. Try rephrasing.');
      const plan = await planned;
      await design(send, env, { query: req.query, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: results, context: req.context?.slice(0, 1500) }, started, late);
      return;
    }
    case 'design':
      await design(send, env, { ...req, context: req.context?.slice(0, 1500) }, started);
      return;
    default: {
      const unreachable: never = req;
      throw new Error(`Unknown stream request ${JSON.stringify(unreachable)}`);
    }
  }
}
