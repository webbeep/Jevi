import { DEEP_PAGES, routeExtras, routeOf } from './router';
import { serperImages } from './cascade';
import { publicEvent } from './publicPayload';
import { contextTerms, entityContextLine, entityHintFor, isDisambiguationPage, isPersonAsk, personSubject, priorEntity, resolveEntity } from './entity';
import { fetchWikiDisambiguation } from './wikiSearch';
import { type EntityHint, mentionsAny } from './imageGate';
import type { RowImagePlan } from './pictures';
import type { AnswerCard, FollowupContext, FollowupIntent, LayoutPlan } from '../shared/card';
import type { EngineStatus, Freshness, ImageResult, SearchResponse } from '../shared/types';
import { rewriteQuery } from './ai';
import { designParallel, designStream } from './design';
import { permitted } from './images';
import { hasLlm } from './llm';
import { collectPages, ogImageOf } from './pages';
import { MADE_PATTERNS } from './patterns';
import { planLayout } from './plan';
import type { AskScope, CallLedger } from './budget';
import { logAsk, moreQueries, newLedger, queriesForAsk } from './budget';
import { gateResults } from './relevanceGate';
import { entityQuery, relaxQuery } from './queryClean';
import { type LateExtras, searchWithLate } from './search';
import type { Send } from './sse';
import { extraQueries, understand } from './understand';
import { cacheBypass, testForce, validTestToken } from './token';
import type { Env } from './util';

export interface CardOnScreen {
  id: number;
  title: string;
  card?: AnswerCard;
  pattern?: string;
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
  | {
      kind: 'followup';
      question: string;
      original: string;
      search: SearchResponse;
      cards: CardOnScreen[];
      context?: string;
      /** Set when the follow-up came from a control or button on card `from` rather than being typed. */
      intent?: FollowupIntent;
      from?: number;
    };

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
  intent?: string;
  /** Deep route: read 3–5 pages (~4s each) and ground on them. */
  deep?: boolean;
  /** Pictures from the one extra Serper /images call, when this picture card had none. */
  boost?: Promise<ImageResult[]>;
  /** T444: disambiguated person/org for the T443 image gate (never loosens it). */
  entityHint?: (entity: string) => EntityHint | undefined;
}

/**
 * T442: pictures for tiles and media rows the designer left blank. The card's one picture search is the
 * T436 boost when it already ran, else one Serper /images call on the card subject — only when Serper
 * served this search (a capped day means og:image or nothing). og:image reads take ~2s at most.
 */
function rowImagePlan(req: DesignArgs, env: Env, scope: AskScope): RowImagePlan {
  let once: Promise<ImageResult[]> | undefined;
  const serperServed = req.search.engines.some((e) => e.name === 'serper' && e.ok);
  return {
    cardImages: () =>
      (once ??= req.boost
        ? req.boost
        : serperServed && !scope.ledger.force
          ? serperImages(req.query, env, scope.eval ? 'eval' : 'prod', () => { scope.ledger.imageCalls = 1; })
          : Promise.resolve([])),
    og: (url) => ogImageOf(url, 2000),
    onFilled: ({ filled, og }) => { if (filled || og) scope.ledger.rowPics = { filled, og }; },
    // T444: the chosen entity plugs into the existing T443 image gate; never a separate filter.
    hintFor: req.entityHint,
  };
}

/** Card types that show pictures. Only these may spend the extra Serper /images call. */
const PICTURE_PATTERNS = new Set(['visual', 'profile', 'spotlight', 'ranked', 'briefing']);

function imageBoost(pattern: string, search: SearchResponse, env: Env, scope: AskScope, query: string): Promise<ImageResult[]> | undefined {
  if (!PICTURE_PATTERNS.has(pattern) || scope.ledger.force) return undefined;
  if (search.images.some((i) => i.license === 'source') || !search.results.length) return undefined;
  // Only when Serper served this search. Cap reached (or Serper skipped/dead): no /images call and no other image provider; og:image or nothing.
  if (!search.engines.some((e) => e.name === 'serper' && e.ok)) return undefined;
  // T443: card-level pictures must mention the subject; a wrong picture is worse than none.
  return serperImages(query, env, scope.eval ? 'eval' : 'prod', () => { scope.ledger.imageCalls = 1; }).then((imgs) => imgs.filter((i) => mentionsAny(query, i)));
}

/** How many pages to read and how long to wait for them before designing. At most five pages per ask. */
const pageBudget = (readPages: boolean) => (readPages ? { count: 5, need: 3, budgetMs: 2200 } : { count: 3, need: 2, budgetMs: 1000 });

/** The model is scored against the person's question, including hits a looser retry brought back. */
function applyRelevance(query: string, response: SearchResponse, ledger: CallLedger): SearchResponse {
  const gated = gateResults(query, response.results);
  ledger.relevanceDropped = (ledger.relevanceDropped ?? 0) + gated.dropped;
  return gated.dropped ? { ...response, results: gated.kept } : response;
}

async function design(send: Send, env: Env, req: DesignArgs, started: number, scope: AskScope, late?: Promise<LateExtras>) {
  // Follow-ups keep the sources already gated for the original question.
  if (!req.followup) req = { ...req, search: applyRelevance(req.query, req.search, scope.ledger) };
  // Cards already on screen point into this search's image list by index, so only a new search may reorder it.
  const newSearch = !req.followup;
  // Writing and code are made for the person, not looked up, so they are composed like a conversation turn.
  if (!req.followup && MADE_PATTERNS.has(req.pattern)) req = { ...req, followup: { mode: 'chat', question: req.query } };
  // Conversation turns reason from what is already known; everything else reads pages first.
  const chat = req.followup?.mode === 'chat';
  const budget = chat ? { count: 3, need: 0, budgetMs: 0 } : req.deep ? DEEP_PAGES : pageBudget(req.readPages);
  const pages = await collectPages(req.search.results, env, budget, late, scope);
  const fresh = pages.filter((p) => !req.search.results[p.n - 1]?.content);
  if (fresh.length) send('pages', fresh.map(({ n, url, text }) => ({ n, url, text })));

  // Page preview images and images from engines that answered late are often the most relevant ones.
  const lateImages = late ? await Promise.race([late.then((l) => l.images), new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 150))]) : [];
  const boosted = req.boost ? await Promise.race([req.boost, new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 1500))]) : [];
  const pageImgs = pages.filter((p) => p.image).map((p) => {
    const source = req.search.results[p.n - 1]?.domain ?? '';
    return { url: p.url, thumb: p.image!, title: req.search.results[p.n - 1]?.title ?? '', source, license: 'source' as const, credit: source };
  });
  const seen = new Set(req.search.images.map((i) => i.thumb));
  const extra = permitted([...boosted, ...pageImgs, ...lateImages], env).filter((i) => i.thumb && !seen.has(i.thumb) && seen.add(i.thumb));
  if (extra.length) {
    const images = newSearch ? [...extra, ...req.search.images].slice(0, 16) : [...req.search.images, ...extra].slice(0, 24);
    req = { ...req, search: { ...req.search, images } };
    send('images', req.search.images);
  }

  send('designing', { pagesRead: pages.length, ms: Date.now() - started });
  // Follow-ups (small answers and redesigns) stay coherent in one call; full search cards are designed region by region in parallel.
  const designer = req.followup ? designStream : designParallel;
  const rowImages = chat ? undefined : rowImagePlan(req, env, scope);
  const summary = await designer({ ...req, pages, context: req.context?.slice(0, 4000), rowImages }, env, {
    thinking: () => send('thinking', {}),
    layout: (regions) => send('layout', regions),
    head: (head) => send('head', head),
    node: (node, index) => send('node', { index, node }),
    followups: (items) => send('followups', items),
    credit: (credit) => send('credit', credit),
  });
  send('done', { ...summary, pagesRead: pages.length, ms: Date.now() - started });
}

/**
 * The literal question is always the first search. Planner rewrites follow on the same engine,
 * inside the three-call cap (two rewrites leave no room for Wikipedia).
 * Rewritten follow-ups already say what they mean, so they skip the understanding step.
 */
async function searchAndDesign(send: Send, env: Env, query: string, freshness: Freshness, context: string | undefined, started: number, scope: AskScope, rewritten = false) {
  const understood = rewritten ? Promise.resolve(undefined) : understand(query, env, context);
  const planned = understood.then((u) => planLayout(query, env, { intent: u?.intent })).then((plan) => {
    send('plan', plan);
    return plan;
  });

  const u = await understood;
  const extras = extraQueries(query, u);
  if (u) send('intent', { intent: u.intent, queries: u.queries });
  // Literal question first. Planner rewrites are the later calls, still inside the cap.
  const q = queriesForAsk(query, extras);
  const route = routeOf(query);
  scope.ledger.route = route;
  const deep = route === 'deep';
  const more = routeExtras(route, moreQueries(query, extras));
  const fresh = freshness === 'any' && u ? u.freshness : freshness;
  const found = await searchWithLate({ q, more, freshness: fresh, count: 20 }, env, scope);
  let results = applyRelevance(query, { ...found.response, query }, scope.ledger);
  let late: Promise<LateExtras> | undefined = found.late;

  if (!results.results.length) {
    const firstEngines = results.engines;
    const reason = noSourceReason(firstEngines);
    scope.ledger.bonus = 2;
    scope.ledger.empty = reason;
    const relaxed = relaxQuery(query);
    const tryRelaxed = relaxed.length > 0 && relaxed.toLowerCase() !== query.trim().toLowerCase();
    let triedEntity = false;
    let recovered: 'relaxed' | 'entity' | 'knowledge' | 'none' = 'none';
    if (tryRelaxed) {
      const again = await searchWithLate({ q: relaxed, freshness: 'any', count: 20 }, env, scope);
      const gated = applyRelevance(query, { ...again.response, query }, scope.ledger);
      if (gated.results.length) {
        results = gated;
        late = again.late;
        recovered = 'relaxed';
      }
    }
    if (!results.results.length) {
      // Picked-choice / person+descriptor: search the bare name and gate on the name so
      // context filters never drop every source (live Which-one? taps → no-sources).
      const person = isPersonAsk(query) ? personSubject(query) : '';
      const entity = (person && person.toLowerCase() !== query.trim().toLowerCase() ? person : '') || entityQuery(query);
      const lower = entity.toLowerCase();
      if (entity && lower !== query.trim().toLowerCase() && lower !== relaxed.toLowerCase()) {
        triedEntity = true;
        const again = await searchWithLate({ q: entity, freshness: 'any', count: 20 }, env, scope);
        const gateQ = person || query;
        const gated = applyRelevance(gateQ, { ...again.response, query: gateQ }, scope.ledger);
        if (gated.results.length) {
          results = gated;
          late = again.late;
          recovered = 'entity';
          if (person) console.log(JSON.stringify({ zo: 'entity', nameFallback: true, kept: gated.results.length }));
        }
      }
    }
    if (!results.results.length && hasLlm(env)) recovered = 'knowledge';
    console.log(JSON.stringify({ zo: 'empty-recovery', reason, providers: engineErrors(firstEngines), relaxed: tryRelaxed, entity: triedEntity, recovered }));
    if (!results.results.length) {
      if (!hasLlm(env)) {
        throw new Error(reason === 'unavailable'
          ? 'Search is unavailable right now. Try again in a few minutes.'
          : 'No results for this search. Try rephrasing.');
      }
      send('search', results);
      send('notice', { kind: 'no-sources', reason });
      const plan = await planned;
      await design(send, env, {
        query,
        pattern: plan.pattern,
        depth: plan.depth,
        readPages: plan.readPages,
        search: results,
        context,
        intent: u?.intent,
        followup: { mode: 'chat', question: query },
      }, started, scope, late);
      return;
    }
  }

  // T444: before building a profile/person card, pick ONE entity from the top
  // results. Ambiguous names return choices instead of a mixed card.
  const plan = await planned;
  // Bare person ask with no Wikipedia "may refer to" in the SERP: one keyless disambiguation lookup (0 Serper).
  if (isPersonAsk(query, plan.pattern) && !contextTerms(query).length && !priorEntity(context)) {
    const name = personSubject(query);
    if (name && !results.results.some((r) => isDisambiguationPage(r))) {
      const wiki = await fetchWikiDisambiguation(name).catch(() => null);
      if (wiki) {
        scope.ledger.search.wikipedia += 1;
        const row = {
          title: wiki.title,
          url: wiki.url,
          snippet: wiki.snippet,
          domain: 'en.wikipedia.org',
          engines: ['wikipedia'],
        };
        results = { ...results, results: [row, ...results.results.filter((r) => r.url !== wiki.url)] };
        console.log(JSON.stringify({ zo: 'entity', wikiDisambiguation: true, title: wiki.title }));
      }
    }
  }
  const decision = resolveEntity(query, results.results, { pattern: plan.pattern, prior: priorEntity(context) });
  if (decision.kind === 'choices') {
    scope.ledger.entity = { kind: 'choices', choices: decision.choices.length };
    console.log(JSON.stringify({ zo: 'entity', kind: 'choices', choices: decision.choices.length }));
    send('search', results);
    // Choices ride on the done event (FE readChoices() in shared/choices.ts); never cached.
    send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started, choices: decision.choices });
    return;
  }
  let designContext = context;
  let entityHint: ((entity: string) => EntityHint | undefined) | undefined;
  let boostQuery = query;
  if (decision.kind === 'single') {
    scope.ledger.entity = { kind: 'single', id: decision.entity.id, dropped: decision.dropped.length };
    console.log(JSON.stringify({ zo: 'entity', kind: 'single', id: decision.entity.id, kept: decision.kept.length, dropped: decision.dropped.length }));
    results = { ...results, results: decision.kept.map((i) => results.results[i]!).filter(Boolean) };
    designContext = [entityContextLine(decision.entity), context].filter(Boolean).join('\n');
    entityHint = entityHintFor(decision.entity, query);
    boostQuery = decision.entity.name;
  }
  send('search', results);
  const boost = imageBoost(plan.pattern, results, env, scope, boostQuery);
  await design(send, env, { query, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages || deep, search: results, context: designContext, intent: u?.intent, deep, boost, entityHint }, started, scope, late);
}

/**
 * Payment, quota, rate, auth, and transport failures on every keyed provider mean search itself is down,
 * even when keyless Wikipedia answered empty. Only a provider that really searched and found nothing is "empty".
 */
function noSourceReason(engines: EngineStatus[]): 'empty' | 'unavailable' {
  const keyed = engines.filter((engine) => engine.name !== 'wikipedia' && engine.name !== 'backup');
  const pool = keyed.length ? keyed : engines;
  if (pool.length > 0 && pool.every((engine) => !!engine.error && engine.error !== 'empty')) return 'unavailable';
  return 'empty';
}

/** Engine name and error only (no query text), e.g. "exa:payment". */
function engineErrors(engines: EngineStatus[]): string[] {
  return engines.filter((engine) => engine.error).map((engine) => `${engine.name}:${engine.error}`);
}

async function followup(send: Send, env: Env, req: Extract<StreamRequest, { kind: 'followup' }>, started: number, scope: AskScope) {
  const context = req.context?.slice(0, 4000);
  const from = req.cards.find((c) => c.id === req.from);

  // A search button on a card: always resolve it against the conversation ("apple varieties" → "best apples for apple pie").
  if (req.intent === 'search') {
    // Card/control prompts (incl. Which-one? choice.query) are already the search string — do not LLM-rewrite.
    const query = req.question.trim();
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'any', context, started, scope, true);
    return;
  }

  // Classify and speculatively rewrite at the same time; the rewrite is only used if Jev says a new search is needed.
  const rewritten = req.intent === 'adjust' ? Promise.resolve(req.question) : rewriteQuery(req.original, req.question, env, context, from?.title).catch(() => req.question);
  const plan = await planLayout(req.question, env, { original: req.original, cards: req.cards.map(({ id, title }) => ({ id, title })), context });
  const mode = req.intent === 'adjust' ? 'refine' : req.intent === 'ask' && plan.mode === 'refine' ? 'answer' : plan.mode ?? 'chat';

  switch (mode) {
    case 'search': {
      send('plan', plan);
      const query = await rewritten;
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', context, started, scope, true);
      return;
    }
    case 'refine': {
      // Adjustments always become a new card; the card they start from stays as it was.
      const base = (req.intent === 'adjust' ? from : req.cards.find((c) => c.id === plan.target)) ?? [...req.cards].reverse().find((c) => c.card);
      if (base?.card) {
        const pattern = base.pattern ?? plan.pattern;
        send('plan', { ...plan, mode, pattern });
        send('base', { id: base.id });
        await design(send, env, { query: req.original, pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'refine', question: req.question, baseCard: base.card }, context }, started, scope);
        return;
      }
      send('plan', { ...plan, mode: 'chat' });
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'chat', question: req.question }, context }, started, scope);
      return;
    }
    case 'answer':
    case 'chat':
      send('plan', { ...plan, mode });
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: req.search, followup: { mode, question: req.question }, context, think: mode === 'chat' && plan.think }, started, scope);
      return;
    default: {
      const unreachable: never = mode;
      throw new Error(`Unknown follow-up mode ${unreachable}`);
    }
  }
}

export interface StreamOpts {
  request?: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function runStream(req: StreamRequest, env: Env, rawSend: Send, opts?: StreamOpts): Promise<void> {
  const started = Date.now();
  const ledger = newLedger();
  // Provider and model names never reach the client (t432); the model goes to the server log.
  const send: Send = (event, data) => {
    const out = publicEvent(event, data);
    if (out.via) ledger.via = out.via;
    rawSend(event, out.data);
  };
  ledger.force = opts?.request ? testForce(opts.request, env) : undefined;
  const scope: AskScope = {
    ledger,
    bypass: opts?.request ? cacheBypass(opts.request, env) : false,
    waitUntil: opts?.waitUntil,
    eval: opts?.request ? validTestToken(opts.request.headers.get('x-zo-test-token'), env.ZO_TEST_TOKEN) : false,
  };
  try {
    switch (req.kind) {
      case 'search':
        await searchAndDesign(send, env, req.query, req.freshness, req.context, started, scope);
        return;
      case 'design':
        await design(send, env, req, started, scope);
        return;
      case 'followup':
        await followup(send, env, req, started, scope);
        return;
      default: {
        const unreachable: never = req;
        throw new Error(`Unknown stream request ${JSON.stringify(unreachable)}`);
      }
    }
  } finally {
    logAsk(scope.ledger, scope.served);
  }
}
