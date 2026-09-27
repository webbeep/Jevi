import { useCallback, useRef, useState } from 'react';
import type { AnswerCard, CardNode, CardResponse, FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, SearchResponse, SearchResult } from '../shared/types';
import { api } from './api';
import { withBrowserFallback } from './fallback';

export type TurnKind = 'search' | 'answer' | 'digest';

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

  const design = useCallback(async (id: number, opts: { pattern?: string; simple?: boolean; followup?: FollowupContext; status?: string } = {}) => {
    const turn = get(id);
    const ctx = searchOf(turn);
    if (!turn?.plan || !ctx?.search) return;
    const mine = epoch.current;
    const pattern = opts.pattern ?? turn.pattern ?? turn.plan.pattern;
    const simple = opts.simple ?? turn.simple;
    const followup = opts.followup ?? (turn.kind === 'answer' ? { mode: 'answer' as const, question: turn.question } : undefined);
    update(id, { filling: true, status: opts.status, pattern, simple, error: undefined });
    try {
      const result = await api.card({ query: ctx.search.query, pattern, depth: turn.plan.depth, readPages: turn.plan.readPages, search: ctx.search, simple, followup });
      if (mine === epoch.current) update(id, (t) => ({ result, version: t.version + 1, filling: false, status: undefined }));
    } catch (err) {
      if (mine === epoch.current) update(id, { filling: false, status: undefined, error: errMsg(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  const runSearchTurn = useCallback(async (id: number, query: string, fresh: Freshness) => {
    const mine = epoch.current;
    update(id, { kind: 'search', question: query, searchId: id, filling: true, plan: undefined, search: undefined, result: undefined, error: undefined });
    const planned = api.plan(query).then((plan) => {
      if (mine === epoch.current) update(id, { plan, pattern: plan.pattern });
      return plan;
    });
    try {
      const search = await withBrowserFallback(await api.search(query, fresh));
      if (mine !== epoch.current) return;
      update(id, { search });
      if (!search.results.length) throw new Error('No results from any engine. Try rephrasing.');
      const plan = await planned;
      if (mine !== epoch.current) return;
      await design(id, { pattern: plan.pattern });
    } catch (err) {
      if (mine === epoch.current) update(id, { filling: false, error: errMsg(err) });
    }
  }, [update, design]);

  const search = useCallback((query: string, opts: { reset: boolean; freshness?: Freshness }) => {
    const q = query.trim();
    if (!q) return;
    if (opts.reset) {
      epoch.current++;
      commit(() => []);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const id = add({ kind: 'search', question: q, filling: true });
    if (!opts.reset) scrollToTurn(id);
    void runSearchTurn(id, q, opts.freshness ?? freshness);
  }, [add, commit, runSearchTurn, freshness]);

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
      plan = await api.plan(q, ctx.question, cards);
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
        update(id, { plan, pattern: plan.pattern });
        const { query } = await api.rewrite(ctx.question, q).catch(() => ({ query: q }));
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

  const digest = useCallback(async (r: SearchResult, searchTurnId: number) => {
    const ctx = get(searchTurnId);
    if (!ctx?.search) return;
    const mine = epoch.current;
    const id = add({ kind: 'digest', question: `Digest: ${r.title}`, searchId: searchTurnId, filling: true });
    scrollToTurn(id);
    try {
      const page = await api.read(r.url, ctx.question);
      const ref = ctx.search.results.findIndex((x) => x.url === r.url) + 1;
      const card: AnswerCard = {
        title: page.title || r.title,
        subtitle: r.domain,
        icon: 'book-open',
        body: [
          { type: 'text', text: page.tldr, size: 'lg' },
          ...(page.bullets.length ? [{ type: 'list' as const, style: 'check' as const, items: page.bullets.map((text) => ({ text })) }] : []),
          ...(ref > 0 ? [{ type: 'citations' as const, refs: [ref] }] : []),
        ],
      };
      if (mine === epoch.current) update(id, (t) => ({ result: { card, followups: [], engine: 'extractive', pagesRead: 1, removed: 0, ms: 0 }, version: t.version + 1, filling: false }));
    } catch (err) {
      if (mine === epoch.current) update(id, { filling: false, error: errMsg(err) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, update]);

  const clear = useCallback(() => {
    epoch.current++;
    commit(() => []);
  }, [commit]);

  const pin = useCallback((id: number, node: CardNode) => update(id, (t) => ({ pins: [...t.pins, node] })), [update]);
  const setPattern = useCallback((id: number, pattern: string) => void design(id, { pattern }), [design]);
  const setSimple = useCallback((id: number, simple: boolean) => void design(id, { simple }), [design]);
  const redesign = useCallback((id: number) => void design(id), [design]);

  return { turns, searchOf, clear, search, followup, refine, digest, pin, setPattern, setSimple, redesign };
}
