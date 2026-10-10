import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AskRef } from '../shared/askAbout';
import type { AnswerCard, CardNode, CardResponse, FollowupContext, FollowupIntent, ImageCredit, LayoutPlan } from '../shared/card';
import { loadSnapshot, normalizeAnswerQuery } from '../shared/answerKey';
import { readChoices } from '../shared/choices';
import { cardDigest } from '../shared/digest';
import { MAX_AUTO_RECONNECTS, OFFLINE_MESSAGE, friendlyError, isConnectionError, reconnectDelay } from '../shared/offline';
import { billingFromSources, settleCardPrices } from '../shared/pricing';
import { emptyDoneState } from '../shared/sse-parse';
import { liveBody } from '../shared/liveBody';
import type { NoSourcesNotice, SearchResponse, SearchResult } from '../shared/types';
import { api } from './api';
import { withBrowserFallback } from './fallback';
import { reportNeedSignin } from './auth/gatebus';
import { NeedSigninError, StreamError, type StreamBody, type PeekRow, type StreamEvent, shouldAutoRetry, stream } from './sse';

export { liveBody } from '../shared/liveBody';

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
  /** The card box a tapped follow-up is about, shown as a chip beside its question. */
  ref?: AskRef;
  /** The card this one is an adjusted version of. */
  base?: { id: number; title: string; card: AnswerCard };
  /** How a follow-up was answered, so redesigns keep the same approach. */
  mode?: Exclude<FollowupContext['mode'], 'refine'>;
  plan?: LayoutPlan;
  /** What the search was understood to want, and the searches run for it. */
  intent?: { intent: string; queries: string[] };
  pattern?: string;
  search?: SearchResponse;
  /** The literal search's first rows, shown while the full search and the layout finish. */
  peek?: PeekRow[];
  /** Set once the answer is being laid out, with how many pages were read for it. */
  designing?: { pagesRead: number };
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
  /** Set when the card was answered without web sources. */
  notice?: NoSourcesNotice;
  /** The failure can be tried again from the same turn. */
  retryable?: boolean;
  /** The failure was a dropped connection; auto-reconnect is pending and the partial stays up. */
  offline?: boolean;
  /** How many auto-reconnect attempts have failed for this turn. */
  reconnects?: number;
  /** Set on the first turn when a snapshot was restored because the network was down. */
  fromCache?: boolean;
}

const emptyLive = (): LiveCard => ({ regions: [], nodes: [], raw: [], followups: [], credits: [] });
const variantKey = (pattern: string | undefined, simple: boolean) => `${pattern ?? ''}|${simple ? 1 : 0}`;

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function connectionLost(err: unknown, userAborted: boolean): boolean {
  const offline = browserOffline();
  if (isConnectionError(err, userAborted, offline)) return true;
  return offline && err instanceof StreamError && (err.reason === 'cut' || err.reason === 'network');
}

function loadCachedTurns(question: string): Turn[] | undefined {
  const read = (store: Storage): Turn[] | undefined => {
    try {
      return loadSnapshot<Turn[]>(store, question);
    } catch {
      return undefined;
    }
  };
  let cached: Turn[] | undefined;
  try {
    cached = read(sessionStorage);
  } catch {
    cached = undefined;
  }
  if (!cached) {
    try {
      cached = read(localStorage);
    } catch {
      cached = undefined;
    }
  }
  if (!Array.isArray(cached) || cached.length === 0) return undefined;
  if (!cached.every((t) => !!t && typeof t.id === 'number' && typeof t.question === 'string' && typeof t.kind === 'string')) return undefined;
  return cached;
}

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
  /** Sparse design slots for the settled card, so a late review can correct a node in place. */
  const settledSlots = useRef(new Map<number, (CardNode | undefined)[]>());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restoreRef = useRef<(incoming: Turn[]) => void>(() => {});
  const retryRef = useRef<(id: number) => void>(() => {});

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
  /** `refresh`: the person pressed Retry, so the server skips its saved answer and search. */
  const run = useCallback(async (id: number, body: StreamBody, opts?: { retry?: boolean; refresh?: boolean }) => {
    bodies.current.set(id, body);
    settledSlots.current.delete(id);
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const mine = epoch.current;
    const alive = () => mine === epoch.current && !controller.signal.aborted;
    let route = id;
    const prior = get(id);
    let sawContent = Boolean(opts?.retry && prior?.live && (prior.live.head || prior.live.nodes.some(Boolean)));
    let resetLive = Boolean(opts?.retry);

    const takeLive = (t: Turn): LiveCard => {
      if (!resetLive) return t.live ?? emptyLive();
      resetLive = false;
      return emptyLive();
    };

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
        case 'notice':
          return update(route, { notice: e.data });
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
        case 'peek':
          return update(route, { peek: e.data });
        case 'designing':
          return update(route, { designing: { pagesRead: e.data.pagesRead } });
        case 'thinking':
          return update(route, { thinking: true });
        case 'layout':
          return update(route, (t) => ({ live: { ...takeLive(t), regions: e.data } }));
        case 'head':
          sawContent = true;
          return update(route, (t) => ({ live: { ...takeLive(t), head: e.data } }));
        case 'node':
          sawContent = true;
          return update(route, (t) => {
            const results = ref.current.find((x) => x.id === t.searchId)?.search?.results ?? [];
            const slots = t.result ? settledSlots.current.get(route) : undefined;
            if (t.result && slots) {
              const placed = placeNode({ regions: [], nodes: slots, raw: slots, followups: t.result.followups, credits: t.result.card.credits ?? [] }, e.data.index, e.data.node, t.question, results);
              settledSlots.current.set(route, placed.raw);
              const body = placed.nodes.filter((n): n is CardNode => !!n);
              const result: CardResponse = { ...t.result, card: { ...t.result.card, body } };
              return { result, variants: { ...t.variants, [variantKey(t.pattern, t.simple)]: result }, live: undefined, filling: false, thinking: false, version: t.version + 1 };
            }
            const live = takeLive(t);
            return { live: placeNode(live, e.data.index, e.data.node, t.question, results), thinking: false, version: live.nodes.some(Boolean) ? t.version : t.version + 1 };
          });
        case 'followups':
          return update(route, (t) => {
            if (!t.result) return { live: { ...(t.live ?? emptyLive()), followups: e.data } };
            const result = { ...t.result, followups: e.data };
            return { result, variants: { ...t.variants, [variantKey(t.pattern, t.simple)]: result }, version: t.version + 1 };
          });
        case 'done':
          return update(route, (t) => {
            if (!t.live?.nodes.some(Boolean)) {
              // An ambiguous name ends with only "Which one?" options and no card body.
              const only = readChoices(e.data, t.live?.head);
              if (only) {
                const result: CardResponse = { card: { title: t.live?.head?.title ?? t.question, body: [] }, followups: [], engine: e.data.engine, pagesRead: e.data.pagesRead, removed: e.data.removed, ms: e.data.ms, choices: only };
                return { result, live: undefined, filling: false, status: undefined, thinking: false, error: undefined, retryable: undefined, offline: undefined, reconnects: undefined };
              }
              return { live: undefined, filling: false, status: undefined, thinking: false, offline: undefined, reconnects: undefined, ...emptyDoneState(Boolean(t.result)) };
            }
            settledSlots.current.set(route, t.live.raw);
            const choices = readChoices(e.data, t.live.head);
            const result: CardResponse = {
              card: { title: t.live.head?.title ?? t.question, ...t.live.head, body: liveBody(t.live, false), credits: t.live.credits },
              followups: t.live.followups,
              engine: e.data.engine,
              pagesRead: e.data.pagesRead,
              removed: e.data.removed,
              ms: e.data.ms,
              via: e.data.via,
              ...(choices ? { choices } : {}),
              ...(e.data.degraded ? { degraded: true as const, degradedReason: e.data.degradedReason } : {}),
            };
            return { result, variants: { ...t.variants, [variantKey(t.pattern, t.simple)]: result }, live: undefined, filling: false, status: undefined, thinking: false, error: undefined, retryable: undefined, offline: undefined, reconnects: undefined };
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
        update(id, { notice: undefined, peek: undefined, designing: undefined });
        try {
          await stream(body, onEvent, controller.signal, { retry: opts?.retry || attempt > 0, refresh: opts?.refresh });
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
      if (err instanceof NeedSigninError) {
        if (alive()) {
          const turn = get(route);
          const question = turn?.question ?? (body.kind === 'followup' ? body.question : body.query);
          const dropped = !turn || !turn.result;
          if (turn && !turn.result) commit((all) => all.filter((t) => t.id !== route));
          else if (turn) update(route, { filling: false, status: undefined, live: undefined, thinking: false, error: undefined, retryable: undefined });
          const pending = dropped && question
            ? {
                q: question,
                kind: body.kind === 'followup' ? 'followup' as const : 'search' as const,
                fromId: body.kind === 'followup' ? body.from : undefined,
                intent: body.kind === 'followup' ? body.intent : undefined,
              }
            : null;
          reportNeedSignin(err, pending ? question : '', pending);
        }
        return;
      }
      let restored = false;
      if (alive() && connectionLost(err, controller.signal.aborted)) {
        const turn = get(route);
        const firstSearch = turn?.kind === 'search' && ref.current[0]?.id === turn.id;
        const cached = firstSearch ? loadCachedTurns(turn.question) : undefined;
        if (cached) {
          restored = true;
          restoreRef.current(cached.map((t, i) => (i === 0 ? { ...t, fromCache: true } : t)));
        } else {
          update(route, (t) => ({
            filling: false,
            thinking: false,
            status: undefined,
            offline: true,
            retryable: true,
            error: OFFLINE_MESSAGE,
            reconnects: opts?.retry ? (t.reconnects ?? 0) + 1 : (t.reconnects ?? 0),
          }));
        }
      } else if (alive()) {
        update(route, { filling: false, status: undefined, live: undefined, thinking: false, offline: undefined, reconnects: undefined, error: friendlyError(err), retryable: err instanceof StreamError ? err.retryable : false });
      }
      if (!restored) throw err;
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

  const runSearchTurn = useCallback(async (id: number, query: string, opts?: { retry?: boolean; refresh?: boolean }) => {
    const keep = Boolean(opts?.retry && get(id)?.offline);
    if (keep) update(id, { kind: 'search', question: query, searchId: id, filling: true, thinking: false, status: undefined });
    else update(id, { kind: 'search', question: query, searchId: id, filling: true, plan: undefined, search: undefined, result: undefined, live: undefined, error: undefined, offline: undefined, reconnects: undefined });
    try {
      await run(id, { kind: 'search', query, freshness: 'any', context: memory(id) || undefined }, opts);
    } catch {
      const turn = get(id);
      if (turn?.offline) return;
      try {
        if (!turn || turn.search?.results.length) return;
        const rescued = await withBrowserFallback(turn.search ?? { query, freshness: 'any', results: [], images: [], discussions: [], engines: [] });
        if (!rescued.results.length) return;
        const plan = turn.plan ?? (await api.plan(query));
        update(id, { search: rescued, plan, pattern: plan.pattern, error: undefined, offline: undefined });
        await design(id, { pattern: plan.pattern });
      } catch {
        /* browser fallback and plan both fail without a connection; the turn already shows an error */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, run, design]);

  const clear = useCallback(() => {
    epoch.current++;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
    reconnectDebounce.current = undefined;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    commit(() => []);
  }, [commit]);

  /** Replays a finished conversation (same-tab reload) without starting a search. */
  const restore = useCallback((incoming: Turn[]) => {
    epoch.current++;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
    reconnectDebounce.current = undefined;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    for (const turn of incoming) if (turn.id > nextId) nextId = turn.id;
    commit(() => incoming.map((t) => ({ ...t, filling: false, live: undefined, thinking: false, status: undefined })));
  }, [commit]);
  restoreRef.current = restore;

  const search = useCallback((query: string, opts: { reset: boolean }) => {
    const q = query.trim();
    if (!q) return;
    if (opts.reset) {
      const first = ref.current[0];
      if (first?.offline && normalizeAnswerQuery(q) === normalizeAnswerQuery(first.question)) {
        retryRef.current(first.id);
        return;
      }
      clear();
      window.scrollTo({ top: 0 });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    } else {
      const last = ref.current[ref.current.length - 1];
      if (last?.offline && normalizeAnswerQuery(q) === normalizeAnswerQuery(last.question)) {
        retryRef.current(last.id);
        return;
      }
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
  const followup = useCallback(async (question: string, fromId?: number, intent?: FollowupIntent, askRef?: AskRef) => {
    const q = question.trim();
    if (!q) return;
    const last = ref.current[ref.current.length - 1];
    if (last?.offline && normalizeAnswerQuery(q) === normalizeAnswerQuery(last.question)) {
      retryRef.current(last.id);
      return;
    }
    const from = fromId ? get(fromId) : [...ref.current].reverse().find((t) => t.result || t.search);
    const ctx = searchOf(from) ?? [...ref.current].reverse().find((t) => t.search);
    if (!ctx?.search) return;
    const base = intent === 'adjust' && from?.result ? { id: from.id, title: from.result.card.title, card: from.result.card } : undefined;
    const id = add({ kind: intent === 'search' ? 'search' : 'answer', question: q, searchId: ctx.id, filling: true, origin: intent, base, pattern: base ? from?.pattern : undefined, ref: askRef });
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
      ...(askRef ? { ref: askRef } : {}),
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, run]);

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
    if (controllers.current.has(id)) return;
    const turn = get(id);
    if (!turn) return;
    if (turn.kind === 'search') {
      void runSearchTurn(id, turn.question, turn.offline ? { retry: true } : { refresh: true });
      return;
    }
    const body = bodies.current.get(id);
    if (!body) return;
    if (turn.offline) {
      update(id, { filling: true, status: undefined, thinking: false });
      void run(id, body, { retry: true }).catch(() => undefined);
      return;
    }
    update(id, { error: undefined, result: undefined, live: undefined, filling: true, status: undefined, thinking: false, retryable: undefined, offline: undefined, reconnects: undefined });
    void run(id, body, { refresh: true }).catch(() => undefined);
  }, [run, runSearchTurn, update]);
  retryRef.current = retry;

  const offlineKey = turns.map((t) => `${t.id}:${t.offline ? 1 : 0}:${t.filling ? 1 : 0}:${t.reconnects ?? 0}`).join(',');
  useEffect(() => {
    const kick = () => {
      for (const t of ref.current) {
        if (t.offline && !t.filling) retry(t.id);
      }
    };
    const onTrigger = () => {
      if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
      reconnectDebounce.current = setTimeout(() => {
        reconnectDebounce.current = undefined;
        kick();
      }, 500);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) onTrigger();
    };
    window.addEventListener('online', onTrigger);
    document.addEventListener('visibilitychange', onVisible);

    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    const due = ref.current.filter((t) => t.offline && !t.filling && (t.reconnects ?? 0) < MAX_AUTO_RECONNECTS);
    if (due.length > 0 && navigator.onLine) {
      const wait = reconnectDelay(due[0].reconnects ?? 0);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = undefined;
        if (!navigator.onLine) return;
        for (const t of ref.current) {
          if (t.offline && !t.filling && (t.reconnects ?? 0) < MAX_AUTO_RECONNECTS) retry(t.id);
        }
      }, wait);
    }

    return () => {
      window.removeEventListener('online', onTrigger);
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = undefined;
      if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
      reconnectDebounce.current = undefined;
    };
  }, [offlineKey, retry]);

  const pin = useCallback((id: number, node: CardNode) => update(id, (t) => ({ pins: [...t.pins, node] })), [update]);
  const setPattern = useCallback((id: number, pattern: string) => switchView(id, pattern, get(id)?.simple ?? false), [switchView]);
  const setSimple = useCallback((id: number, simple: boolean) => {
    const t = get(id);
    switchView(id, t?.pattern ?? t?.plan?.pattern ?? 'answer', simple);
  }, [switchView]);
  const redesign = useCallback((id: number) => void design(id), [design]);

  // Stable across renders, so turns that didn't change can skip re-rendering.
  const actions = useMemo(
    () => ({ searchOf, clear, restore, search, followup, retry, pin, setPattern, setSimple, redesign }),
    [searchOf, clear, restore, search, followup, retry, pin, setPattern, setSimple, redesign],
  );
  return { turns, actions };
}

export type SessionActions = ReturnType<typeof useSession>['actions'];
