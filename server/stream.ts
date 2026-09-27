import type { FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, SearchResponse } from '../shared/types';
import { designParallel, designStream } from './design';
import { collectPages } from './pages';
import { planLayout, quickAnswer } from './plan';
import { searchWithLate } from './search';
import type { Send } from './sse';
import type { Env } from './util';

export type StreamRequest =
  | { kind: 'search'; query: string; freshness: Freshness }
  | {
      kind: 'design';
      query: string;
      pattern: string;
      depth: LayoutPlan['depth'];
      readPages: boolean;
      search: SearchResponse;
      simple?: boolean;
      followup?: FollowupContext;
    };

/** How many pages to read and how long to wait for them before designing. */
const pageBudget = (readPages: boolean) => (readPages ? { count: 5, need: 3, budgetMs: 2200 } : { count: 3, need: 2, budgetMs: 1000 });

async function design(
  send: Send,
  env: Env,
  req: { query: string; pattern: string; depth: LayoutPlan['depth']; readPages: boolean; search: SearchResponse; simple?: boolean; followup?: FollowupContext },
  started: number,
  late?: Promise<Map<string, string>>,
) {
  const budget = pageBudget(req.readPages);
  const pages = await collectPages(req.search.results, env, budget, late);
  const fresh = pages.filter((p) => !req.search.results[p.n - 1]?.content);
  if (fresh.length) send('pages', fresh);
  send('designing', { pagesRead: pages.length, ms: Date.now() - started });
  // Redesigns need the whole current card in one context; everything else is designed region by region in parallel.
  const designer = req.followup?.mode === 'refine' ? designStream : designParallel;
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
      // Jev picks the instant answer from the first engine to respond, while the rest of the search finishes.
      let quick: Promise<unknown> = Promise.resolve();
      let quickSent = false;
      const tryQuick = (results: SearchResponse) =>
        quickAnswer(req.query, results, env)
          .then((q) => {
            if (q && !quickSent) {
              quickSent = true;
              send('quick', q);
            }
          })
          .catch((err) => console.error('quick answer failed', err));
      const { response: results, late } = await searchWithLate({ q: req.query, freshness: req.freshness, count: 20 }, env, (first) => {
        quick = tryQuick({ query: req.query, freshness: req.freshness, results: first, images: [], discussions: [], engines: [] });
      });
      send('search', results);
      if (!results.results.length) throw new Error('No results from any engine. Try rephrasing.');
      const plan = await planned;
      quick = quick.then(() => (quickSent ? undefined : tryQuick(results)));
      await design(send, env, { query: req.query, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: results }, started, late);
      await quick;
      return;
    }
    case 'design':
      await design(send, env, req, started);
      return;
    default: {
      const unreachable: never = req;
      throw new Error(`Unknown stream request ${JSON.stringify(unreachable)}`);
    }
  }
}
