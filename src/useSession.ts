import { useCallback, useMemo, useRef, useState } from 'react';
import type { AnswerCard, CardNode, CardResponse, FollowupContext, FollowupIntent, ImageCredit, LayoutPlan } from '../shared/card';
import { cardDigest } from '../shared/digest';
import { billingFromSources, settleCardPrices } from '../shared/pricing';
import type { SearchResponse, SearchResult } from '../shared/types';
import { api } from './api';
import { withBrowserFallback } from './fallback';
import { emptyDoneState } from '../shared/sse-parse';
import { StreamError, type StreamBody, type StreamEvent, shouldAutoRetry, stream } from './sse';

export type TurnKind = 'search' | 'answer' | 'digest';

export interface LiveCard {
  head?: Omit<AnswerCard, 'body'>;
  /** Placeholder regions being filled in parallel (empty for single-call designs). */
  regions: CardNode[];
  /** Designed nodes by position; parallel regions may arrive out of order. Prices settled across the whole card. */
  nodes: (CardNode | undefined)[];
  /** Nodes as they arrived (billing basis settled, no prices removed), so prices can be re-settled when the pricing table lands. */
  raw: (CardNode | undefined)[];
  followups: string[];
  credits: ImageCredit[];
}

export interface Turn {
  id: number;
  kind: TurnKind;
  /** What the person typed or clicked for this turn. */
  question: string;
  /** The search turn whose results this turn is built from (itself for search turns). */
  searchId: number;
  /** Set when this turn came from a control or button on a card rather than being typed. */
  origin?: FollowupIntent;
  /** The card this one is an adjusted version of. */
  base?: { id: number; title: string; card: AnswerCard };
  /** How a follow-up was answered, so redesigns keep the same approach. */
  mode?: Exclude<FollowupContext['mode'], 'refine'>;
  plan?: LayoutPlan;
  /** What the search was understood to want, and the searches run for it. */
  intent?: { intent: string; queries: string[] };
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
  simple: boolean;
  pins: CardNode[];
  error?: string;
  /** The failure can be tried again from the same turn. */
  retryable?: boolean;
}

const emptyLive = (): LiveCard => ({ regions: [], nodes: [], raw: [], followups: [], credits: [] });
const variantKey = (pattern: string | undefined, simple: boolean) => `${pattern ?? ''}|${simple ? 1 : 0}`;
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Billing basis is settled here per node, not on the worker. Stray prices are settled across the card (`settleCardPrices`). */
function settleBilling(node: CardNode, results: SearchResult[]): CardNode {
  const fix = (n: CardNode): CardNode => {
    if (n.type === 'pricing') {
      return {
        ...n,
        plans: n.plans.map((plan) => ({
          ...plan,
          prices: plan.prices.map((price) => {
            const billing = billingFromSources(price, results);
            return billing === price.billing ? price : { ...price, billing };
          }),
        })),
      };
    }
    if (n.type === 'tabs') return { ...n, tabs: n.tabs.map((tab) => ({ ...tab, children: tab.children.map(fix) })) };
    if ('children' in n) return { ...n, children: n.children.map(fix) };
    return n;
  };
  return fix(node);
}

/**
 * Puts one streamed node into the live card. Prices are re-settled over every node each time,
 * because the pricing table usually streams in after the hero that repeats its price.
 */
export function placeNode(live: LiveCard, index: number, node: CardNode, query: string, results: SearchResult[]): LiveCard {
  const raw = [...live.raw];
  raw[index] = settleBilling(node, results);
  return { ...live, raw, nodes: settleCardPrices(raw, query) };
}

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
  const bodies = useRef(new Map<number, StreamBody>());

  const commit = useCallback((fn: (prev: Turn[]) => Turn[]) => {
    ref.current = fn(ref.current);
    setTurns(ref.current);
  }, []);
  const get = (id: number) => ref.current.find((t) => t.id === id);
  const update = useCallback((id: number, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
    commit((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }, [commit]);
  const add = useCallback((turn: Omit<Turn, 'id' | 'version' | 'simple' | 'pins' | 'searchId' | 'variants'> & { searchId?: number }) => {
    const id = ++nextId;
    commit((all) => [...all, { version: 0, simple: false, pins: [], variants: {}, ...turn, searchId: turn.searchId ?? id, id }]);
    return id;
  }, [commit]);
  const searchOf = useCallback((t: Turn | undefined) => (t ? ref.current.find((x) => x.id === t.searchId) : undefined), []);

  /**
   * Conversation memory for the model: the topic the conversation started with,
   * short digests of earlier turns, and a fuller digest of the card being acted
   * on (or the latest one), so follow-ups never lose the subject.
   */
  const memory = (beforeId?: number, focusId?: number) => {
    const done = ref.current.filter((t) => t.result && (beforeId === undefined || t.id < beforeId));
    if (!done.length) return '';
    const focus = done.find((t) => t.id === focusId) ?? done[done.length - 1];
    const earlier = done.filter((t) => t !== focus).slice(-7);
    return [
      `Topic: ${ref.current[0]?.question ?? focus.question}`,
      ...(earlier.length ? ['Earlier turns, oldest first:', ...earlier.map((t) => `- Q: ${t.question} → ${cardDigest(t.result!.card, 260)}`)] : []),
      `${focusId === focus.id ? 'Card they are acting on' : 'Latest card'} (Q: ${focus.question}): ${cardDigest(focus.result!.card, 1100)}`,
    ].join('\n');
  };

  /**
   * Streams `body` into turn `id`, event by event. A follow-up stream can be
   * re-routed mid-flight: to an existing card (redesign) or into a new search.
   */
  const run = useCallback(async (id: number, body: StreamBody) => {
    bodies.current.set(id, body);
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const mine = epoch.current;
    const alive = () => mine === epoch.current && !controller.signal.aborted;
    let route = id;
    let sawContent = false;

    const onEvent = (e: StreamEvent) => {
      if (!alive()) return;
      switch (e.event) {
        case 'plan':
          return update(route, (t) => (t.result ? {} : { plan: e.data, pattern: e.data.pattern, mode: e.data.mode === 'answer' || e.data.mode === 'chat' ? e.data.mode : t.mode }));
        case 'base': {
          const base = get(e.data.id)?.result;
          return base ? update(route, { base: { id: e.data.id, title: base.card.title, card: base.card } }) : undefined;
        }
        case 'credit':
          return update(route, (t) => {
            const live = t.live ?? emptyLive();
            return live.credits.some((c) => c.src === e.data.src) ? {} : { live: { ...live, credits: [...live.credits, e.data] } };
          });
        case 'rewrite':
          return update(route, { kind: 'search', question: e.data.query, searchId: route, mode: undefined });
        case 'intent':
          return update(route, { intent: e.data });
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
          sawContent = true;
          return update(route, (t) => ({ live: { ...(t.live ?? emptyLive()), head: e.data } }));
        case 'node':
          sawContent = true;
          return update(route, (t) => {
            const live = t.live ?? emptyLive();
            const results = ref.current.find((x) => x.id === t.searchId)?.search?.results ?? [];
            return { live: placeNode(live, e.data.index, e.data.node, t.question, results), thinking: false, version: live.nodes.some(Boolean) ? t.version : t.version + 1 };
          });
        case 'followups':
          return update(route, (t) => ({ live: { ...(t.live ?? emptyLive()), followups: e.data } }));
        case 'done':
          return update(route, (t) => {
            if (!t.live?.nodes.some(Boolean)) {
              return { live: undefined, filling: false, status: undefined, thinking: false, ...emptyDoneState(Boolean(t.result)) };
            }
            const result: CardResponse = {
              card: { title: t.live.head?.title ?? t.question, ...t.live.head, body: liveBody(t.live, false), credits: t.live.credits },
              followups: t.live.followups,
              engine: e.data.engine,
              pagesRead: e.data.pagesRead,
              removed: e.data.removed,
              ms: e.data.ms,
              via: e.data.via,
            };
            return { result, variants: { ...t.variants, [variantKey(t.pattern, t.simple)]: result }, live: undefined, filling: false, status: undefined, thinking: false, error: undefined, retryable: undefined };
          });
        case 'error':
          throw new StreamError(e.data.message, 'server', e.data.retryable ?? true);
        default: {
          const unreachable: never = e;
          return unreachable;
        }
      }
    };

    try {
      let attempt = 0;
      for (;;) {
        try {
          await stream(body, onEvent, controller.signal, attempt > 0 ? { retry: true } : undefined);
          break;
        } catch (err) {
          if (!shouldAutoRetry(err, attempt, sawContent) || !alive()) throw err;
          attempt += 1;
          route = id;
          sawContent = false;
          update(id, { live: undefined, error: undefined, retryable: undefined, filling: true, thinking: false, status: undefined });
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (!alive()) throw err;
        }
      }
    } catch (err) {
      if (alive()) update(route, { filling: false, status: undefined, live: undefined, thinking: false, error: errMsg(err), retryable: err instanceof StreamError ? err.retryable : false });
      throw err;
    } finally {
      controller.abort();
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
    }
  }, [update, commit]);

  const design = useCallback(async (id: number, opts: { pattern?: string; simple?: boolean; followup?: FollowupContext; status?: string } = {}) => {
    const turn = get(id);
    const ctx = searchOf(turn);
    if (!turn?.plan || !ctx?.search) return;
    const pattern = opts.pattern ?? turn.pattern ?? turn.plan.pattern;
    const simple = opts.simple ?? turn.simple;
    const followup = opts.followup
      ?? (turn.base ? { mode: 'refine' as const, question: turn.question, baseCard: turn.base.card } : turn.kind === 'answer' ? { mode: turn.mode ?? 'answer', question: turn.question } : undefined);
    update(id, { filling: true, status: opts.status, pattern, simple, error: undefined, live: undefined });
    const context = memory(id, turn.base?.id) || undefined;
    await run(id, { kind: 'design', query: ctx.search.query, pattern, depth: turn.plan.depth, readPages: turn.plan.readPages, search: ctx.search, simple, followup, context }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, run]);

  const runSearchTurn = useCallback(async (id: number, query: string) => {
    update(id, { kind: 'search', question: query, searchId: id, filling: true, plan: undefined, search: undefined, result: undefined, live: undefined, error: undefined });
    try {
      await run(id, { kind: 'search', query, freshness: 'any', context: memory(id) || undefined });
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

  /**
   * Any message after the first search, typed or from a card. Typed messages let Jev decide whether to chat,
   * answer, adjust a card or search; card controls say what they want (`intent`). Either way the answer is a
   * new card — the card it came from stays as it was.
   */
  const followup = useCallback(async (question: string, fromId?: number, intent?: FollowupIntent) => {
    const q = question.trim();
    const from = fromId ? get(fromId) : [...ref.current].reverse().find((t) => t.result || t.search);
    const ctx = searchOf(from) ?? [...ref.current].reverse().find((t) => t.search);
    if (!q || !ctx?.search) return;
    const base = intent === 'adjust' && from?.result ? { id: from.id, title: from.result.card.title, card: from.result.card } : undefined;
    const id = add({ kind: intent === 'search' ? 'search' : 'answer', question: q, searchId: ctx.id, filling: true, origin: intent, base, pattern: base ? from?.pattern : undefined });
    scrollToTurn(id);
    const cards = ref.current.filter((t) => t.result && t.id !== id).slice(-8).map((t) => ({ id: t.id, title: t.result!.card.title, card: t.result!.card, pattern: t.pattern }));
    await run(id, {
      kind: 'followup',
      question: q,
      original: ref.current[0]?.question ?? ctx.question,
      search: ctx.search,
      cards,
      context: memory(id, from?.id) || undefined,
      intent,
      from: from?.id,
    }).catch(() => undefined);
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

  const retry = useCallback((id: number) => {
    const turn = get(id);
    if (!turn) return;
    if (turn.kind === 'search') {
      void runSearchTurn(id, turn.question);
      return;
    }
    const body = bodies.current.get(id);
    if (!body) return;
    update(id, { error: undefined, result: undefined, live: undefined, filling: true, status: undefined, thinking: false, retryable: undefined });
    void run(id, body).catch(() => undefined);
  }, [run, runSearchTurn, update]);

  const pin = useCallback((id: number, node: CardNode) => update(id, (t) => ({ pins: [...t.pins, node] })), [update]);
  const setPattern = useCallback((id: number, pattern: string) => switchView(id, pattern, get(id)?.simple ?? false), [switchView]);
  const setSimple = useCallback((id: number, simple: boolean) => {
    const t = get(id);
    switchView(id, t?.pattern ?? t?.plan?.pattern ?? 'answer', simple);
  }, [switchView]);
  const redesign = useCallback((id: number) => void design(id), [design]);

  // Stable across renders, so turns that didn't change can skip re-rendering.
  const actions = useMemo(
    () => ({ searchOf, clear, search, followup, digest, retry, pin, setPattern, setSimple, redesign }),
    [searchOf, clear, search, followup, digest, retry, pin, setPattern, setSimple, redesign],
  );
  return { turns, actions };
}

export type SessionActions = ReturnType<typeof useSession>['actions'];
