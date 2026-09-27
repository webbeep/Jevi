import { useCallback, useRef, useState } from 'react';
import type { AnswerCard, CardNode, CardResponse, FollowupContext, LayoutPlan } from '../shared/card';
import { cardDigest } from '../shared/digest';
import type { SearchResponse, SearchResult } from '../shared/types';
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

export interface Turn {
  id: number;
  kind: TurnKind;
  /** What the person typed or clicked for this turn. */
  question: string;
  /** The search turn whose results this turn is built from (itself for search turns). */
  searchId: number;
  /** How a follow-up was answered, so redesigns keep the same approach. */
  mode?: Exclude<FollowupContext['mode'], 'refine'>;
  plan?: LayoutPlan;
  pattern?: string;
  search?: SearchResponse;
  /** The card as it streams in; replaced by `result` when complete. */
  live?: LiveCard;
  result?: CardResponse;
  /** Finished designs by layout + simple, so switching views back and forth is instant. */
  variants: Record<string, CardResponse>;
  version: number;
  filling: boolean;
  /** The model is reasoning before it designs. */
  thinking?: boolean;
  /** Set while an existing card is being redesigned. */
  status?: string;
  refinements: string[];
  simple: boolean;
  pins: CardNode[];
  error?: string;
}

const emptyLive = (): LiveCard => ({ regions: [], nodes: [], followups: [] });
const variantKey = (pattern: string | undefined, simple: boolean) => `${pattern ?? ''}|${simple ? 1 : 0}`;
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The body to show right now: designed nodes where ready, placeholders for regions still being designed. */
export function liveBody(live: LiveCard, stillDesigning: boolean): CardNode[] {
  const length = Math.max(live.nodes.length, stillDesigning ? live.regions.length : 0);
  return Array.from({ length }, (_, i) => live.nodes[i] ?? (stillDesigning ? live.regions[i] : undefined)).filter((n): n is CardNode => !!n);
}

export function scrollToTurn(id: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
}

let nextId = 0;

export function useSession() {
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
  const add = useCallback((turn: Omit<Turn, 'id' | 'version' | 'refinements' | 'simple' | 'pins' | 'searchId' | 'variants'> & { searchId?: number }) => {
    const id = ++nextId;
    commit((all) => [...all, { version: 0, refinements: [], simple: false, pins: [], variants: {}, ...turn, searchId: turn.searchId ?? id, id }]);
    return id;
  }, [commit]);
  const searchOf = (t: Turn | undefined) => (t ? get(t.searchId) : undefined);

  /** Compact summary of the finished turns before `beforeId`, oldest first. */
  const contextBefore = (beforeId?: number) =>
    ref.current
      .filter((t) => t.result && (beforeId === undefined || t.id < beforeId))
      .slice(-6)
      .map((t) => `- Q: ${t.question}\n  A: ${cardDigest(t.result!.card)}`)
      .join('\n');

  /**
   * Streams `body` into turn `id`, event by event. A follow-up stream can be
   * re-routed mid-flight: to an existing card (redesign) or into a new search.
   */
  const run = useCallback(async (id: number, body: StreamBody) => {
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const mine = epoch.current;
    const alive = () => mine === epoch.current && !controller.signal.aborted;
    let route = id;

    const onEvent = (e: StreamEvent) => {
      if (!alive()) return;
      switch (e.event) {
        case 'plan':
          return update(route, (t) => (t.result ? {} : { plan: e.data, pattern: e.data.pattern, mode: e.data.mode === 'answer' || e.data.mode === 'chat' ? e.data.mode : t.mode }));
        case 'target': {
          const placeholder = route;
          route = e.data.id;
          commit((all) => all.filter((t) => t.id !== placeholder));
          const question = body.kind === 'followup' ? body.question : '';
          update(route, (t) => ({ filling: true, live: undefined, status: `Redesigning: ${question}`, refinements: [...t.refinements, question] }));
          scrollToTurn(route);
          return;
        }
        case 'rewrite':
          return update(route, { kind: 'search', question: e.data.query, searchId: route, mode: undefined });
        case 'search':
          return update(route, { search: e.data });
        case 'pages': {
          const target = searchOf(get(route));
          if (!target?.search) return;
          const results = target.search.results.map((r, i) => {
            const page = e.data.find((p) => p.n === i + 1);
            return page && !r.content ? { ...r, content: page.text } : r;
          });
          return update(target.id, { search: { ...target.search, results } });
        }
        case 'images': {
          const target = searchOf(get(route));
          if (!target?.search) return;
          return update(target.id, { search: { ...target.search, images: e.data } });
        }
        case 'designing':
          return;
        case 'thinking':
          return update(route, { thinking: true });
        case 'layout':
          return update(route, (t) => ({ live: { ...(t.live ?? emptyLive()), regions: e.data } }));
        case 'head':
          return update(route, (t) => ({ live: { ...(t.live ?? emptyLive()), head: e.data } }));
        case 'node':
          return update(route, (t) => {
            const live = t.live ?? emptyLive();
            const nodes = [...live.nodes];
            nodes[e.data.index] = e.data.node;
            return { live: { ...live, nodes }, thinking: false, version: live.nodes.some(Boolean) ? t.version : t.version + 1 };
          });
        case 'followups':
          return update(route, (t) => ({ live: { ...(t.live ?? emptyLive()), followups: e.data } }));
        case 'done':
          return update(route, (t) => {
            if (!t.live?.nodes.some(Boolean)) return { live: undefined, filling: false, status: undefined, thinking: false };
            const result: CardResponse = {
              card: { title: t.live.head?.title ?? t.question, ...t.live.head, body: liveBody(t.live, false) },
              followups: t.live.followups,
              engine: e.data.engine,
              pagesRead: e.data.pagesRead,
              removed: e.data.removed,
              ms: e.data.ms,
            };
            return { result, variants: { ...t.variants, [variantKey(t.pattern, t.simple)]: result }, live: undefined, filling: false, status: undefined, thinking: false };
          });
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
      if (alive()) update(route, { filling: false, status: undefined, live: undefined, thinking: false, error: errMsg(err) });
      throw err;
    } finally {
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
    }
  }, [update, commit]);

  const design = useCallback(async (id: number, opts: { pattern?: string; simple?: boolean; followup?: FollowupContext; status?: string } = {}) => {
    const turn = get(id);
    const ctx = searchOf(turn);
    if (!turn?.plan || !ctx?.search) return;
    const pattern = opts.pattern ?? turn.pattern ?? turn.plan.pattern;
    const simple = opts.simple ?? turn.simple;
    const followup = opts.followup ?? (turn.kind === 'answer' ? { mode: turn.mode ?? 'answer', question: turn.question } : undefined);
    update(id, { filling: true, status: opts.status, pattern, simple, error: undefined, live: undefined });
    const context = turn.kind === 'search' ? undefined : contextBefore(id) || undefined;
    await run(id, { kind: 'design', query: ctx.search.query, pattern, depth: turn.plan.depth, readPages: turn.plan.readPages, search: ctx.search, simple, followup, context }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, run]);

  const runSearchTurn = useCallback(async (id: number, query: string) => {
    update(id, { kind: 'search', question: query, searchId: id, filling: true, plan: undefined, search: undefined, result: undefined, live: undefined, error: undefined });
    try {
      await run(id, { kind: 'search', query, freshness: 'any', context: contextBefore(id) || undefined });
    } catch {
      const turn = get(id);
      if (!turn || turn.search?.results.length) return;
      const rescued = await withBrowserFallback(turn.search ?? { query, freshness: 'any', results: [], images: [], discussions: [], engines: [] });
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

  const search = useCallback((query: string, opts: { reset: boolean }) => {
    const q = query.trim();
    if (!q) return;
    if (opts.reset) {
      clear();
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
    const id = add({ kind: 'search', question: q, filling: true });
    if (!opts.reset) scrollToTurn(id);
    void runSearchTurn(id, q);
  }, [add, clear, runSearchTurn]);

  /** Redesigns an existing card in place, straight from a control or action on it. */
  const refine = useCallback((id: number, instruction: string) => {
    const turn = get(id);
    if (!turn?.result) return;
    scrollToTurn(id);
    update(id, (t) => ({ refinements: [...t.refinements, instruction] }));
    void design(id, { status: `Redesigning: ${instruction}`, followup: { mode: 'refine', question: instruction, baseCard: turn.result.card } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, design]);

  /** Any message after the first search: Jev decides whether to chat, answer, redesign a card or search. */
  const followup = useCallback(async (question: string, fromId?: number) => {
    const q = question.trim();
    const from = fromId ? get(fromId) : [...ref.current].reverse().find((t) => t.result || t.search);
    const ctx = searchOf(from) ?? [...ref.current].reverse().find((t) => t.search);
    if (!q || !ctx?.search) return;
    const id = add({ kind: 'answer', question: q, searchId: ctx.id, filling: true });
    scrollToTurn(id);
    const cards = ref.current.filter((t) => t.result && t.id !== id).slice(-6).map((t) => ({ id: t.id, title: t.result!.card.title, card: t.result!.card }));
    await run(id, { kind: 'followup', question: q, original: ctx.question, search: ctx.search, cards, context: contextBefore(id) || undefined }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, run]);

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

  /** Shows a cached design for this view if there is one; otherwise designs it. */
  const switchView = useCallback((id: number, pattern: string, simple: boolean) => {
    const cached = get(id)?.variants[variantKey(pattern, simple)];
    if (cached) {
      update(id, (t) => ({ pattern, simple, result: cached, version: t.version + 1, live: undefined, error: undefined }));
      return;
    }
    void design(id, { pattern, simple });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, design]);

  const pin = useCallback((id: number, node: CardNode) => update(id, (t) => ({ pins: [...t.pins, node] })), [update]);
  const setPattern = useCallback((id: number, pattern: string) => switchView(id, pattern, get(id)?.simple ?? false), [switchView]);
  const setSimple = useCallback((id: number, simple: boolean) => {
    const t = get(id);
    switchView(id, t?.pattern ?? t?.plan?.pattern ?? 'answer', simple);
  }, [switchView]);
  const redesign = useCallback((id: number) => void design(id), [design]);

  return { turns, searchOf, clear, search, followup, refine, digest, pin, setPattern, setSimple, redesign };
}
