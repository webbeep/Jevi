import { useCallback, useRef, useState } from 'react';
import type { AnswerCard, CardNode, CardResponse, FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, SearchResponse, SearchResult } from '../shared/types';
import { cardDigest } from '../shared/digest';
import { api } from './api';
import { withBrowserFallback } from './fallback';
import { type StreamBody, type StreamEvent, stream } from './sse';

export type TurnKind = 'search' | 'answer' | 'digest';

export interface LiveCard {
  head?: Omit<AnswerCard, 'body'>;
  /** Placeholder regions being filled in parallel (empty for single-call designs). */
  regions: CardNode[];
  /** Designed nodes by position; parallel regions may arrive out of order. */
  nodes: (CardNode | undefined)[];
  followups: string[];
}

const emptyLive = (): LiveCard => ({ regions: [], nodes: [], followups: [] });

/** The body to show right now: designed nodes where ready, placeholders for regions still being designed. */
export function liveBody(live: LiveCard, stillDesigning: boolean): CardNode[] {
  const length = Math.max(live.nodes.length, stillDesigning ? live.regions.length : 0);
  return Array.from({ length }, (_, i) => live.nodes[i] ?? (stillDesigning ? live.regions[i] : undefined)).filter((n): n is CardNode => !!n);
}

export interface Turn {
  id: number;
  kind: TurnKind;
  /** What the person typed or clicked for this turn. */
  question: string;
  /** The search turn whose results this turn is built from (itself for search turns). */
  searchId: number;
  plan?: LayoutPlan;
  pattern?: string;
  search?: SearchResponse;
  /** The card as it streams in; replaced by `result` when complete. */
  live?: LiveCard;
  result?: CardResponse;
  version: number;
  filling: boolean;
  /** Set while an existing card is being redesigned. */
  status?: string;
  refinements: string[];
  simple: boolean;
  pins: CardNode[];
  error?: string;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function scrollToTurn(id: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
}

let nextId = 0;

export function useSession(freshness: Freshness) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const ref = useRef<Turn[]>([]);
  const epoch = useRef(0);
  const controllers = useRef(new Map<number, AbortController>());

  const commit = useCallback((fn: (prev: Turn[]) => Turn[]) => {
    ref.current = fn(ref.current);
    setTurns(ref.current);
  }, []);
  const get = (id: number) => ref.current.find((t) => t.id === id);
  const update = useCallback((id: number, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
    commit((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }, [commit]);
  const add = useCallback((turn: Omit<Turn, 'id' | 'version' | 'refinements' | 'simple' | 'pins' | 'searchId'> & { searchId?: number }) => {
    const id = ++nextId;
    commit((all) => [...all, { version: 0, refinements: [], simple: false, pins: [], ...turn, searchId: turn.searchId ?? id, id }]);
    return id;
  }, [commit]);
  const searchOf = (t: Turn | undefined) => (t ? get(t.searchId) : undefined);
  /** Compact summary of the finished turns before `beforeId`, oldest first. */
  const contextBefore = (beforeId?: number) =>
    ref.current
      .filter((t) => t.result && (beforeId === undefined || t.id < beforeId))
      .slice(-4)
      .map((t) => `- Q: ${t.question} → ${cardDigest(t.result!.card)}`)
      .join('\n');

  /** Streams `body` into turn `id`, updating it event by event. */
  const run = useCallback(async (id: number, body: StreamBody) => {
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const mine = epoch.current;
    const alive = () => mine === epoch.current && !controller.signal.aborted;

    const onEvent = (e: StreamEvent) => {
      if (!alive()) return;
      switch (e.event) {
        case 'plan':
          return update(id, { plan: e.data, pattern: e.data.pattern });
        case 'search':
          return update(id, { search: e.data });
        case 'pages': {
          const target = searchOf(get(id));
          if (!target?.search) return;
          const results = target.search.results.map((r, i) => {
            const page = e.data.find((p) => p.n === i + 1);
            return page && !r.content ? { ...r, content: page.text } : r;
          });
          return update(target.id, { search: { ...target.search, results } });
        }
        case 'images': {
          const target = searchOf(get(id));
          if (!target?.search) return;
          return update(target.id, { search: { ...target.search, images: e.data } });
        }
        case 'designing':
          return;
        case 'layout':
          return update(id, (t) => ({ live: { ...(t.live ?? emptyLive()), regions: e.data } }));
        case 'head':
          return update(id, (t) => ({ live: { ...(t.live ?? emptyLive()), head: e.data } }));
        case 'node':
          return update(id, (t) => {
            const live = t.live ?? emptyLive();
            const nodes = [...live.nodes];
            nodes[e.data.index] = e.data.node;
            return { live: { ...live, nodes }, version: live.nodes.some(Boolean) ? t.version : t.version + 1 };
          });
        case 'followups':
          return update(id, (t) => ({ live: { ...(t.live ?? emptyLive()), followups: e.data } }));
        case 'done':
          return update(id, (t) => ({
            result: t.live?.nodes.some(Boolean)
              ? { card: { title: t.live.head?.title ?? t.question, ...t.live.head, body: liveBody(t.live, false) }, followups: t.live.followups, engine: e.data.engine, pagesRead: e.data.pagesRead, removed: e.data.removed, ms: e.data.ms }
              : t.result,
            live: undefined,
            filling: false,
            status: undefined,
          }));
        case 'error':
          throw new Error(e.data.message);
        default: {
          const unreachable: never = e;
          return unreachable;
        }
      }
    };

    try {
      await stream(body, onEvent, controller.signal);
    } catch (err) {
      if (alive()) update(id, { filling: false, status: undefined, live: undefined, error: errMsg(err) });
      throw err;
    } finally {
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
    }
  }, [update]);

  const design = useCallback(async (id: number, opts: { pattern?: string; simple?: boolean; followup?: FollowupContext; status?: string } = {}) => {
    const turn = get(id);
    const ctx = searchOf(turn);
    if (!turn?.plan || !ctx?.search) return;
    const pattern = opts.pattern ?? turn.pattern ?? turn.plan.pattern;
    const simple = opts.simple ?? turn.simple;
    const followup = opts.followup ?? (turn.kind === 'answer' ? { mode: 'answer' as const, question: turn.question } : undefined);
    update(id, { filling: true, status: opts.status, pattern, simple, error: undefined, live: undefined });
    const context = turn.kind === 'search' ? undefined : contextBefore(id) || undefined;
    await run(id, { kind: 'design', query: ctx.search.query, pattern, depth: turn.plan.depth, readPages: turn.plan.readPages, search: ctx.search, simple, followup, context }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, run]);

  const runSearchTurn = useCallback(async (id: number, query: string, fresh: Freshness) => {
    update(id, { kind: 'search', question: query, searchId: id, filling: true, plan: undefined, search: undefined, result: undefined, live: undefined, error: undefined });
    try {
      await run(id, { kind: 'search', query, freshness: fresh, context: contextBefore(id) || undefined });
    } catch {
      const turn = get(id);
      if (!turn || turn.search?.results.length) return;
      const rescued = await withBrowserFallback(turn.search ?? { query, freshness: fresh, results: [], images: [], discussions: [], engines: [] });
      if (!rescued.results.length) return;
      const plan = turn.plan ?? (await api.plan(query));
      update(id, { search: rescued, plan, pattern: plan.pattern, error: undefined });
      await design(id, { pattern: plan.pattern });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, run, design]);

  const clear = useCallback(() => {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    commit(() => []);
  }, [commit]);

  const search = useCallback((query: string, opts: { reset: boolean; freshness?: Freshness }) => {
    const q = query.trim();
    if (!q) return;
    if (opts.reset) {
      clear();
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
    const id = add({ kind: 'search', question: q, filling: true });
    if (!opts.reset) scrollToTurn(id);
    void runSearchTurn(id, q, opts.freshness ?? freshness);
  }, [add, clear, runSearchTurn, freshness]);

  const refine = useCallback((id: number, instruction: string) => {
    const turn = get(id);
    if (!turn?.result) return;
    scrollToTurn(id);
    update(id, (t) => ({ refinements: [...t.refinements, instruction] }));
    void design(id, { status: `Redesigning: ${instruction}`, followup: { mode: 'refine', question: instruction, baseCard: turn.result.card } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, design]);

  const followup = useCallback(async (question: string, fromId?: number) => {
    const q = question.trim();
    const from = fromId ? get(fromId) : [...ref.current].reverse().find((t) => t.result);
    const ctx = searchOf(from);
    if (!q || !from || !ctx?.search) return;
    const mine = epoch.current;
    const id = add({ kind: 'answer', question: q, searchId: ctx.id, filling: true });
    scrollToTurn(id);

    let plan: LayoutPlan;
    try {
      const cards = ref.current.filter((t) => t.result && t.id !== id).map((t) => ({ id: t.id, title: t.result!.card.title }));
      plan = await api.plan(q, ctx.question, cards, contextBefore(id));
    } catch (err) {
      update(id, { filling: false, error: errMsg(err) });
      return;
    }
    if (mine !== epoch.current) return;

    switch (plan.mode ?? 'answer') {
      case 'refine': {
        const chosen = plan.target !== undefined ? get(plan.target) : undefined;
        const target = chosen?.result ? chosen : from.result ? from : [...ref.current].reverse().find((t) => t.result && t.searchId === ctx.id);
        if (target) {
          commit((all) => all.filter((t) => t.id !== id));
          refine(target.id, q);
          return;
        }
        update(id, { plan, pattern: plan.pattern });
        await design(id, { pattern: plan.pattern });
        return;
      }
      case 'search': {
        const { query } = await api.rewrite(ctx.question, q, contextBefore(id)).catch(() => ({ query: q }));
        if (mine === epoch.current) await runSearchTurn(id, query, freshness);
        return;
      }
      case 'answer':
        update(id, { plan, pattern: plan.pattern });
        await design(id, { pattern: plan.pattern });
        return;
      default: {
        const unreachable: never = plan.mode as never;
        return unreachable;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, commit, update, design, refine, runSearchTurn, freshness]);

  /** Turns one source page into its own card. */
  const digest = useCallback(async (r: SearchResult, searchTurnId: number) => {
    const ctx = get(searchTurnId);
    if (!ctx?.search) return;
    const mine = epoch.current;
    const id = add({ kind: 'digest', question: `Summarize: ${r.title}`, searchId: searchTurnId, filling: true });
    scrollToTurn(id);
    try {
      const page = await api.read(r.url, ctx.question, r.content);
      const n = ctx.search.results.findIndex((x) => x.url === r.url) + 1;
      const card: AnswerCard = {
        title: page.title || r.title,
        subtitle: r.domain,
        icon: 'book-open',
        body: [
          { type: 'text', text: page.tldr, size: 'lg' },
          ...(page.bullets.length ? [{ type: 'list' as const, style: 'check' as const, items: page.bullets.map((text) => ({ text })) }] : []),
          ...(n > 0 ? [{ type: 'citations' as const, refs: [n] }] : []),
        ],
      };
      if (mine === epoch.current) update(id, (t) => ({ result: { card, followups: [], engine: 'extractive', pagesRead: 1, removed: 0, ms: 0 }, version: t.version + 1, filling: false }));
    } catch (err) {
      if (mine === epoch.current) update(id, { filling: false, error: errMsg(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, update]);

  const pin = useCallback((id: number, node: CardNode) => update(id, (t) => ({ pins: [...t.pins, node] })), [update]);
  const setPattern = useCallback((id: number, pattern: string) => void design(id, { pattern }), [design]);
  const setSimple = useCallback((id: number, simple: boolean) => void design(id, { simple }), [design]);
  const redesign = useCallback((id: number) => void design(id), [design]);

  return { turns, searchOf, clear, search, followup, refine, digest, pin, setPattern, setSimple, redesign };
}
