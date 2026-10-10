import { DEEP_PAGES, routeExtras, routeOf } from './router';
import { serperImages } from './cascade';
import { publicEvent } from './publicPayload';
import {
  askTopic,
  askedQuestions,
  contextTerms,
  correctedPersonQuery,
  distinguishingTerms,
  vowelSwap,
  entityContextLine,
  type Entity,
  type EntityChoice,
  type EntityDecision,
  entityHintFor,
  formalNameQueries,
  isDisambiguationPage,
  isPersonAsk,
  knowledgeForKept,
  knowledgeRow,
  nameIsTopic,
  personSourceOk,
  personSubject,
  commaDetailQuery,
  pickSeeds,
  pickTopic,
  pickTopicQuery,
  priorEntity,
  publicChoices,
  resolveEntity,
} from './entity';
import { fetchWikiDisambiguation, fetchWikiLeadImage } from './wikiSearch';
import { type EntityHint, mentionsAny } from './imageGate';
import type { RowImagePlan } from './pictures';
import type { AnswerCard, CardNode, FollowupContext, FollowupIntent, LayoutPlan } from '../shared/card';
import { type AskRef, refContext, withRef } from '../shared/askAbout';
import type { EngineStatus, Freshness, ImageResult, SearchResponse, SearchResult } from '../shared/types';
import { rewriteQuery } from './ai';
import { type DesignRequest, designParallel, designStream, gateNode } from './design';
import { BRIEF_ROWS, briefSources, remapBrief, type SourceBrief } from './brief';
import { keepPictures, reviewCard } from './review';
import { permitted } from './images';
import { hasLlm } from './llm';
import { collectPages, ogImageOf } from './pages';
import { MADE_PATTERNS, skeletonCard } from './patterns';
import { planLayout } from './plan';
import type { AskScope, CallLedger } from './budget';
import { SEARCH_CALL_CAP, logAsk, mark, moreQueries, newLedger, queriesForAsk, searchCalls } from './budget';
import { gateResults } from './relevanceGate';
import { entityQuery, plainQuotes, relaxQuery, tickerQueries } from './queryClean';
import { type LateExtras, normalizeUrl, searchWithLate } from './search';
import type { WebHit } from './cascade';
import { domainOf } from './util';
import { choicesIn, distinctActions, subjectWords } from './chips';
import { cryptographyHint, faithfulQuery, isWritingAsk, quickPlan, scrubLeak, standsAlone, withoutLeakActions, withoutRepeatedCallouts } from './askGuard';
import { isOwnSite, orcidSite, pickOwnSite, probeOwnSite, RESEARCH_ASK, withOwnSite } from './ownSite';
import { quoteAsk } from '../shared/quoteAsk';
import { scholarlyResults, withScholarly } from './scholarly';
import { videoResults, withVideos } from './videoSearch';
import { guessFreshness, preferFresh, staleComplaint, stricter } from './freshness';
import { isQuoteRow, liveQuote, quoteRow, tickerNode } from './liveQuote';
import { splitPeople } from './peopleSplit';
import { personSteer, threadPerson, topicOnly, withoutChosen } from './personSteer';
import type { Send } from './sse';
import { extraQueries, understand } from './understand';
import { cacheBypass, testForce, validTestToken, wantsRefresh } from './token';
import { SERPER_ANON_SHARE } from './providerCap';
import type { Env } from './util';

export { guessFreshness } from './freshness';

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
      /** The card box the follow-up is about (a tapped tile/row/profile), when it came from one. */
      ref?: AskRef;
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
  /** A price card's lead: the live price and chart, built from the quote feed. */
  ticker?: CardNode;
  /** The source check, started on the literal search's rows while the rewrites were still searching. */
  earlyBrief?: Promise<EarlyBrief | undefined>;
  /** Source number of the person's own website, linked from the profile. */
  website?: number;
}

interface EarlyBrief {
  brief: SourceBrief;
  judged: SearchResult[];
}

const TICKER_SHOWN = 'a live price chart with the current price, today\'s intraday line and 1W to 5Y history from the quote feed';

const webRow = (h: WebHit): SearchResult => ({ title: h.title, url: h.url, snippet: h.snippet, domain: domainOf(h.url), engines: ['web'], date: h.date, content: h.content });

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

/**
 * EN4 pick gate: an ask that names an org/role ("Ray Lee BlueFlame AI", "David Kim C2 founder")
 * keeps only rows about that very person, so a namesake's page can never seed the card or a
 * choice label. When everything drops, the empty-results recovery runs instead.
 */
function applyPickGate(query: string, response: SearchResponse): SearchResponse {
  if (!isPersonAsk(query) || !distinguishingTerms(query).length || nameIsTopic(query, response.results)) return response;
  const kept = response.results.filter((row) => personSourceOk(query, row));
  if (kept.length === response.results.length) return response;
  console.log(JSON.stringify({ zo: 'entity', pickGate: true, kept: kept.length, dropped: response.results.length - kept.length }));
  return { ...response, results: kept };
}

/** What the ask adds to the person's name: "Ed Chu Bf ai" -> "Bf ai". */
function askDetail(query: string, subject: string): string {
  const names = new Set(subject.toLowerCase().split(/\s+/));
  return query.replace(/^\s*(who\s+is|who\s+was|who's)\s+/i, '').replace(/[?]+\s*$/, '').split(/\s+/).filter((w) => !names.has(w.toLowerCase().replace(/[^a-z'-]/g, ''))).join(' ').replace(/^[,\s-]+/, '').trim();
}

const QUOTE_EXTRAS_MS = 700;
const PEEK_ROWS = 8;

const WHO_ASK = /^\s*(who\s+is|who\s+was|who's)\b/i;

/** The model's split of the rows into people when it finds at least two; the heuristic choices otherwise. */
async function sharperChoices(choices: EntityChoice[], rows: SearchResult[], env: Env): Promise<EntityChoice[]> {
  const name = choices[0]?.name;
  const split = name ? await splitPeople(name, rows, env) : undefined;
  console.log(JSON.stringify({ zo: 'entity', kind: 'choices', choices: (split ?? choices).length, by: split ? 'model' : 'heuristic' }));
  return split ?? choices;
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
  // The source check runs while pages are read, so it costs little or no extra time.
  // Usually it already ran on the literal search's rows while the rewrites were searching.
  const briefing = !newSearch || chat ? undefined
    : req.earlyBrief ? req.earlyBrief.then((early) => early && remapBrief(early.brief, early.judged, req.search.results))
    : briefSources({ query: req.query, intent: req.intent, context: req.context, results: req.search.results, isLive: isQuoteRow, shown: req.ticker ? TICKER_SHOWN : undefined }, env);
  const [pages, brief] = await Promise.all([collectPages(req.search.results, env, budget, late, scope).finally(() => mark(scope.ledger, 'pages')), briefing?.finally(() => mark(scope.ledger, 'brief'))]);
  if (brief) console.log(JSON.stringify({ zo: 'brief', use: brief.use.length, stale: brief.stale, offTopic: brief.offTopic, conflicts: brief.conflicts.length, missing: !!brief.missing }));
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
  // A live quote is one number told one way: regions designed in parallel each repeat the price and the chart.
  const quoteCard = isQuoteRow(req.search.results[0]);
  const designer = req.followup || quoteCard ? designStream : designParallel;
  const rowImages = chat || quoteCard ? undefined : rowImagePlan(req, env, scope);
  const designReq: DesignRequest = { ...req, pages, brief, context: req.context?.slice(0, 4000), rowImages };
  const shown = new Map<number, CardNode>();
  const subject = subjectWords(req.query, req.followup?.question);
  let head: Omit<AnswerCard, 'body'> | undefined;
  let followups: string[] = [];
  const summary = await designer(designReq, env, {
    thinking: () => send('thinking', {}),
    layout: (regions) => send('layout', regions),
    head: (h) => {
      head = h;
      send('head', h);
    },
    node: (node, index) => {
      if (req.website) node = withWebsite(node, req.website);
      const priorNodes = [...shown].filter(([at]) => at !== index).map(([, n]) => n);
      const keptNode = withoutRepeatedCallouts(node, priorNodes);
      if (!keptNode) return;
      node = keptNode;
      if (node.type === 'actions') {
        const clean = withoutLeakActions(node);
        if (!clean) return;
        const kept = distinctActions(clean, choicesIn([...shown.values()]), subject);
        if (!kept) return;
        node = kept;
      }
      shown.set(index, node);
      send('node', { index, node });
      const choices = choicesIn([node]);
      if (!choices.length) return;
      for (const [at, prior] of shown) {
        if (prior.type !== 'actions') continue;
        const kept = distinctActions(prior, choices, subject);
        if (kept === prior) continue;
        if (kept) shown.set(at, kept);
        else shown.delete(at);
        send('node', { index: at, node: kept ?? { type: 'actions', items: [] } });
      }
    },
    followups: (items) => {
      followups = items;
      send('followups', items);
    },
    credit: (credit) => send('credit', credit),
  });
  mark(scope.ledger, 'designed');
  if (!chat && req.followup?.mode !== 'refine' && summary.engine === 'composed') {
    await checkAnswer(send, env, designReq, shown, head, followups, started);
    mark(scope.ledger, 'reviewed');
  }
  send('done', { ...summary, pagesRead: pages.length, ms: Date.now() - started });
}

/** The finished card, read once against the goal before it is saved: wrong nodes are corrected in place. */
async function checkAnswer(send: Send, env: Env, req: DesignRequest, shown: Map<number, CardNode>, head: Omit<AnswerCard, 'body'> | undefined, followups: string[], started: number) {
  const at = Date.now();
  const review = await reviewCard({
    query: req.followup?.question ?? req.query,
    context: req.context,
    brief: req.brief,
    results: req.search.results,
    pages: req.pages,
    isLive: isQuoteRow,
    head,
    nodes: shown,
    followups,
  }, env);
  if (!review) return;
  if (review.followups) send('followups', review.followups);
  let fixed = 0;
  for (const fix of review.fixes) {
    const gated = gateNode(fix.node, req);
    if (!gated) continue;
    const node = keepPictures(shown.get(fix.index), gated) as CardNode;
    shown.set(fix.index, node);
    send('node', { index: fix.index, node });
    fixed++;
  }
  const warning = review.note ? gateNode({ type: 'callout', tone: 'warning', icon: 'triangle-alert', text: review.note }, req) : undefined;
  const leadIndex = [...shown.keys()].sort((a, b) => a - b).find((i) => !['actions', 'citations'].includes(shown.get(i)!.type));
  const lead = leadIndex === undefined ? undefined : shown.get(leadIndex);
  const leadWarns = lead?.type === 'callout' && lead.tone === 'warning' || (lead?.type === 'stack' && lead.children[0]?.type === 'callout' && lead.children[0].tone === 'warning');
  if (warning && leadIndex !== undefined && !leadWarns) {
    send('node', { index: leadIndex, node: { type: 'stack', direction: 'col', gap: 'sm', children: [warning, shown.get(leadIndex)!] } });
  }
  console.log(JSON.stringify({ zo: 'review', ok: review.ok, problems: review.problems, fixed, followups: !!review.followups, warned: !!warning, ms: Date.now() - at, total: Date.now() - started }));
}

/**
 * The literal question is always the first search. Planner rewrites follow on the same engine,
 * inside the three-call cap (two rewrites leave no room for Wikipedia).
 * Rewritten follow-ups already say what they mean, so they skip the understanding step.
 */
async function searchAndDesign(send: Send, env: Env, query: string, freshness: Freshness, context: string | undefined, started: number, scope: AskScope, rewritten = false, seedRows?: SearchResult[], steer?: { avoid: Set<string>; rejected: string }) {
  const understood = rewritten ? Promise.resolve(undefined) : understand(query, env, context).finally(() => mark(scope.ledger, 'understood'));
  const planned = understood.then((u) => planLayout(query, env, { intent: u?.intent })).then((plan) => {
    send('plan', plan);
    return plan;
  });

  // Keyless, in parallel with the web search: a price ask is answered from the live quote, not old articles.
  const quoting = liveQuote(query).finally(() => mark(scope.ledger, 'quote'));
  // A person named with what they do ("Jessica Hamrick DeepMind", a tapped Which-one? choice) is often too
  // little-known for the engines to surface their own website, so guess it from the name while the search runs.
  const siteLookup = !steer && isPersonAsk(query) && contextTerms(query).length ? lookupOwnSite(query) : undefined;
  // The source check needs only rows, so it starts on the literal search's and overlaps the wait for the rewrites'.
  let intentNow: string | undefined;
  void understood.then((x) => { intentNow = x?.intent; });
  let earlyBrief: Promise<EarlyBrief | undefined> | undefined;
  const onLiteral = (hits: WebHit[]) => {
    if (earlyBrief) return;
    // A first look at what the search found, shown while the rest of the search and the layout finish.
    send('peek', gateResults(query, hits.map(webRow)).kept.slice(0, PEEK_ROWS).map(({ title, url, domain, date }) => ({ title, url, domain, date })));
    earlyBrief = quoting.then(async (quote) => {
      const rows = [...(quote ? [quoteRow(quote)] : []), ...gateResults(query, hits.map(webRow)).kept].slice(0, BRIEF_ROWS);
      const brief = await briefSources({ query, intent: intentNow, context, results: rows, isLive: isQuoteRow, shown: quote ? TICKER_SHOWN : undefined }, env);
      mark(scope.ledger, 'brief');
      return brief && { brief, judged: rows };
    });
  };
  const route = routeOf(query);
  scope.ledger.route = route;
  const deep = route === 'deep';
  let found: Awaited<ReturnType<typeof searchWithLate>>;
  let u: Awaited<typeof understood>;
  // SPD-C4 (t457): paper/DOI asks also read OpenAlex, in parallel with the web search.
  const scholarly = scholarlyResults(query);
  // Watch asks also read YouTube (keyless), in parallel: web results rarely carry a playable video.
  const videos = videoResults(query);
  // Searches that need no model ("$rdw" → "RDW stock news today") lead the rewrites.
  const instant = [...tickerQueries(query), ...formalNameQueries(query)];
  if (!rewritten) {
    // SPD2 (t457): every ask searches its literal words at once; the understood rewrites join the same
    // engine when the intent read lands (~1 s), instead of the whole search waiting for it. A time-sensitive
    // ask takes its literal freshness from its own words; the rewrites use the intent read's.
    const literalFresh = freshness === 'any' ? guessFreshness(query) : freshness;
    const later = understood.then((x) => {
      if (x) send('intent', { intent: x.intent, queries: x.queries });
      return { more: routeExtras(route, moreQueries(query, [...instant, ...extraQueries(query, x)])), freshness: freshness === 'any' ? x?.freshness ?? literalFresh : freshness };
    });
    // A price ask is answered by the live quote; the rewrites only add the news around it.
    found = await searchWithLate({ q: queriesForAsk(query, []), more: routeExtras(route, moreQueries(query, instant)), later, freshness: literalFresh, count: 20, waitExtras: deep, extrasCutMs: quoteAsk(query) ? QUOTE_EXTRAS_MS : undefined, onLiteral }, env, scope);
    mark(scope.ledger, 'found');
    u = await understood;
  } else {
    u = undefined;
    // Literal question first. Planner rewrites are the later calls, still inside the cap.
    const q = queriesForAsk(query, instant);
    const more = routeExtras(route, moreQueries(query, instant));
    found = await searchWithLate({ q, more, freshness: freshness === 'any' ? guessFreshness(query) : freshness, count: 20, onLiteral }, env, scope);
  }
  let results = applyPickGate(query, applyRelevance(query, { ...found.response, query }, scope.ledger));
  // "AI news today" must not lead with last week's launch: past-window rows drop once enough current ones remain.
  const span = freshness !== 'any' ? freshness : stricter(guessFreshness(query), u?.freshness === 'day' || u?.freshness === 'week' ? u.freshness : 'any');
  results = { ...results, results: preferFresh(results.results, span) };
  const scholar = await scholarly;
  if (scholar.length) results = { ...results, results: withScholarly(scholar, results.results) };
  const clips = await videos;
  if (clips.length) results = { ...results, results: withVideos(clips, results.results) };
  const quote = await quoting;
  const live = quote ? quoteRow(quote) : undefined;
  if (live) {
    results = { ...results, results: [live, ...results.results.filter((r) => !isQuoteRow(r))] };
    console.log(JSON.stringify({ zo: 'quote', symbol: quote!.symbol, source: quote!.source, ms: Date.now() - started }));
  }
  let late: Promise<LateExtras> | undefined = found.late;
  // EN4 part 8: set when the answer is rebuilt from the rows behind a Which-one? pick, so the
  // seed pages get re-read instead of designed from the snippets alone.
  let fromSeeds = false;

  if (!results.results.length) {
    const firstEngines = results.engines;
    const reason = noSourceReason(firstEngines);
    scope.ledger.bonus = 2;
    scope.ledger.empty = reason;
    const relaxed = relaxQuery(query);
    const tryRelaxed = relaxed.length > 0 && relaxed.toLowerCase() !== query.trim().toLowerCase();
    let triedEntity = false;
    let recovered: 'relaxed' | 'entity' | 'knowledge' | 'seeds' | 'none' = 'none';
    if (tryRelaxed) {
      const again = await searchWithLate({ q: relaxed, freshness: 'any', count: 20 }, env, scope);
      const gated = applyPickGate(query, applyRelevance(query, { ...again.response, query }, scope.ledger));
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
      // A long company word that matched nothing is usually a misspelling ("Bleuflame").
      // The two recovery calls learn the spelling the pages use, then search the person
      // with it. The bare name would spend those calls on namesakes.
      const orgWord = person ? distinguishingTerms(query).find((t) => t.length >= 6) : undefined;
      if (orgWord) {
        triedEntity = true;
        const swapped = vowelSwap(orgWord);
        if (swapped) {
          const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
          if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - room);
          const guess = `${person} ${swapped[0]!.toUpperCase()}${swapped.slice(1)}`;
          const named = await searchWithLate({ q: guess, freshness: 'any', count: 10, lite: true }, env, scope);
          const kept = applyPickGate(query, applyRelevance(query, { ...named.response, query }, scope.ledger));
          if (kept.results.length) {
            results = kept;
            late = named.late;
            recovered = 'entity';
            console.log(JSON.stringify({ zo: 'entity', spelling: guess, kept: kept.results.length }));
          }
        }
        if (!results.results.length) {
          const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
          if (room < 2) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (2 - room);
          const org = contextTerms(query).join(' ');
          const looked = await searchWithLate({ q: org, freshness: 'any', count: 8, lite: true, ungated: true }, env, scope);
          const spelling = correctedPersonQuery(query, looked.response.results);
          if (spelling && spelling.toLowerCase() !== `${person} ${swapped}`.toLowerCase()) {
            const named = await searchWithLate({ q: spelling, freshness: 'any', count: 10, lite: true }, env, scope);
            const kept = applyPickGate(query, applyRelevance(query, { ...named.response, query }, scope.ledger));
            if (kept.results.length) {
              results = kept;
              late = named.late;
              recovered = 'entity';
              console.log(JSON.stringify({ zo: 'entity', spelling, kept: kept.results.length }));
            }
          }
        }
      }
      const entity = (person && person.toLowerCase() !== query.trim().toLowerCase() ? person : '') || entityQuery(query);
      const lower = entity.toLowerCase();
      if (!results.results.length && entity && lower !== query.trim().toLowerCase() && lower !== relaxed.toLowerCase()) {
        triedEntity = true;
        const again = await searchWithLate({ q: entity, freshness: 'any', count: 20 }, env, scope);
        const gateQ = person || query;
        const gated = applyRelevance(gateQ, { ...again.response, query: gateQ }, scope.ledger);
        // The bare-name SERP is other people's pages about half the time: keep only rows about
        // the person the ask named (live "Ray Lee Raycon Founder" built from a funeral home).
        const pickPerson = !!person && distinguishingTerms(query).length > 0;
        const picked = pickPerson ? gated.results.filter((row) => personSourceOk(query, row)) : gated.results;
        const gatedOut = gated.results.length - picked.length;
        if (picked.length) {
          results = { ...gated, results: picked };
          late = again.late;
          recovered = 'entity';
        } else if (pickPerson && !orgWord) {
          // EN4 part 8: the tap that offered these choices is still in hand, so re-ask on the rows
          // behind the picked choice before offering the same choices again (live "Ray Lee Raycon
          // Founder" → the LinkedIn/ZoomInfo rows, never "No results for this search").
          const seeds = !results.results.length && seedRows?.length && isPersonAsk(query) ? pickSeeds(query, seedRows) : undefined;
          if (seeds?.seeds.length) {
            results = { ...results, results: seeds.seeds.map((i) => seedRows![i]!), knowledge: undefined };
            fromSeeds = true;
            recovered = 'seeds';
            console.log(JSON.stringify({ zo: 'entity', pickSeeds: seeds.seeds.length, label: seeds.label }));
          }
        }
        if (person) console.log(JSON.stringify({ zo: 'entity', nameFallback: true, kept: picked.length, gatedOut }));
      }
    }
    if (!results.results.length && seedRows?.length) {
      // A tapped chip names something the card on screen already cited: answer from those rows, not a dead end.
      // A person + detail only takes rows about that very person, never a namesake's that shares the name.
      const person = isPersonAsk(query) ? personSubject(query) : '';
      const term = (person || entityQuery(query) || query).toLowerCase();
      const cited = person && distinguishingTerms(query).length
        ? seedRows.filter((row) => personSourceOk(query, row))
        : seedRows.filter((row) => `${row.title} ${row.snippet}`.toLowerCase().includes(term));
      if (cited.length) {
        results = { ...results, results: cited, knowledge: undefined };
        fromSeeds = true;
        recovered = 'seeds';
      }
    }
    if (!results.results.length && hasLlm(env)) recovered = 'knowledge';
    console.log(JSON.stringify({ zo: 'empty-recovery', reason, providers: engineErrors(firstEngines), relaxed: tryRelaxed, entity: triedEntity, recovered }));
    if (!results.results.length) {
      // EN4 part 8: a person ask never ends in "No results for this search" — the person the ask
      // named is still on screen, so say plainly that nothing more turned up (never choices again).
      const subject = personSubject(query);
      // Only a tapped Which-one? choice or a person + descriptor ask ("Ray Lee BlueFlame AI"): a bare
      // name ask ("Who is Elon Musk") still gets the LLM knowledge answer instead of this one.
      if (isPersonAsk(query) && subject && (seedRows?.length || distinguishingTerms(query).length > 0)) {
        const label = pickSeeds(query, seedRows ?? []).label;
        const detail = askDetail(query, subject);
        console.log(JSON.stringify({ zo: 'entity', pickEmpty: true }));
        send('search', { ...results, results: [] });
        if (scope.ledger.gateSample?.length) send('gate', scope.ledger.gateSample);
        send('head', { title: subject, subtitle: label || detail });
        const text = detail
          ? `I couldn't find a page that connects ${subject} to “${detail}”. Try the full name of the company, school or city.`
          : `I couldn't find more about ${subject}${label ? ` (${label})` : ''} right now.`;
        send('node', { index: 0, node: { type: 'text', text, size: 'lg' } });
        send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started });
        return;
      }
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
  if (!live && isPersonAsk(query, plan.pattern) && !contextTerms(query).length && !priorEntity(context) && !nameIsTopic(query, results.results)) {
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
    // EN4: the knowledge panel is a Wikipedia summary of the literal query, so put it in the row
    // list (right after any disambiguation page) and let the entity pick decide whose card it is.
    // No extra call — the panel is already on the search response.
    const panel = knowledgeRow(results.knowledge, results.results);
    if (panel) {
      const at = results.results.findIndex((r) => isDisambiguationPage(r));
      results = {
        ...results,
        results: [...results.results.slice(0, at + 1), panel as SearchResult, ...results.results.slice(at + 1)],
      };
      console.log(JSON.stringify({ zo: 'entity', knowledgeRow: true, title: panel.title }));
    }
  }
  let rejectedSplit: EntityChoice[] | undefined;
  if (steer) {
    // "Not this one": the rejected card's pages go, and the model sorts what is left into the other people.
    const others = results.results.filter((r) => !steer.avoid.has(normalizeUrl(r.url)));
    if (others.length) results = { ...results, results: others, knowledge: undefined };
    rejectedSplit = await splitPeople(personSubject(query), results.results, env, { exclude: steer.rejected, min: 1 });
    if (rejectedSplit?.length === 1) {
      results = { ...results, results: rejectedSplit[0]!.seeds!.map((i) => results.results[i]!) };
      rejectedSplit = undefined;
    }
  }
  const prior = steer ? undefined : priorEntity(context);
  const decision: EntityDecision = live ? { kind: 'skip' } : resolveEntity(query, results.results, { pattern: plan.pattern, prior });
  // A bare "who is" for someone without an encyclopedia page, whose namesakes the heuristic dropped:
  // the model may still see several people worth offering ("who is Ed Chu" → oncologist, EPA official, CEO).
  const unsure = !steer && decision.kind === 'single' && !prior && decision.dropped.length >= 2 && WHO_ASK.test(query) && !distinguishingTerms(query).length
    && !results.knowledge && !decision.kept.some((i) => /\.wikipedia\.org\//i.test(results.results[i]?.url ?? ''));
  const split = rejectedSplit ?? (unsure ? await splitPeople(decision.entity.name, results.results, env) : undefined);
  if (split) console.log(JSON.stringify({ zo: 'entity', kind: 'choices', choices: split.length, by: 'model-over-single' }));
  if (decision.kind === 'choices' || split) {
    const choices = split ?? (decision.kind === 'choices' ? await sharperChoices(decision.choices, results.results, env) : []);
    scope.ledger.entity = { kind: 'choices', choices: choices.length };
    send('search', results);
    // Choices ride on the done event (FE readChoices() in shared/choices.ts); never cached.
    send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started, choices: publicChoices(choices) });
    return;
  }
  let designContext = context;
  let entityHint: ((entity: string) => EntityHint | undefined) | undefined;
  let boostQuery = query;
  let pattern = plan.pattern;
  let website: number | undefined;
  if (decision.kind === 'single') {
    scope.ledger.entity = { kind: 'single', id: decision.entity.id, dropped: decision.dropped.length };
    console.log(JSON.stringify({ zo: 'entity', kind: 'single', id: decision.entity.id, kept: decision.kept.length, dropped: decision.dropped.length }));
    results = { ...results, results: decision.kept.map((i) => results.results[i]!).filter(Boolean) };
    // EN4: the knowledge panel is the article of one of the kept rows or nothing at all — a
    // namesake's encyclopedia text/photo must never land on another person's card.
    const panel = results.knowledge;
    if (panel && !knowledgeForKept(panel, results.results)) {
      results = { ...results, knowledge: undefined, images: results.images.filter((i) => i.url !== panel.url) };
      console.log(JSON.stringify({ zo: 'entity', knowledgeDropped: true, title: panel.title }));
    }
    const site = await ownSiteFor(query, decision.entity, results.results, siteLookup);
    if (site) {
      const placed = withOwnSite(results.results, site);
      results = { ...results, results: placed.rows };
      website = placed.n;
      designContext = [entityContextLine(decision.entity), `Own website: source [${placed.n}] (${site.domain}); the profile already links it, so no action for it. Prefer it for who they are and what they do now, and cite it.`, context].filter(Boolean).join('\n');
      console.log(JSON.stringify({ zo: 'entity', ownSite: site.engines[0], n: placed.n }));
    } else {
      designContext = [entityContextLine(decision.entity), context].filter(Boolean).join('\n');
    }
    entityHint = entityHintFor(decision.entity, query);
    // Name + the asker's own context ("Ray Lee BlueFlame AI") pulls that person's photos, not a namesake's.
    boostQuery = contextTerms(query).length ? query : decision.entity.name;
    // Person singles must be profile cards so image boost + row pictures run (Lead GATE: David Kim / BlueFlame had 0 imgs on answer pattern),
    // unless the ask is about something of theirs ("Jaylen Brown injuries"): that keeps the planned layout.
    if (pattern !== 'profile' && !askTopic(query, decision.entity.name)) {
      pattern = 'profile';
      send('plan', { ...plan, pattern, skeleton: skeletonCard(query, pattern) });
    }
    // The kept Wikipedia article's own lead image (keyless, 0 Serper). It still goes through the image gate:
    // title/source carry the article title + snippet, so the chosen person's name/org must be on it.
    const wikiRow = results.results.find((r) => /^https:\/\/en\.wikipedia\.org\/wiki\//i.test(r.url) && !isDisambiguationPage(r));
    if (wikiRow && !results.images.some((i) => i.url === wikiRow.url)) {
      const lead = await fetchWikiLeadImage(wikiRow.url).catch(() => null);
      if (lead) {
        scope.ledger.search.wikipedia += 1;
        const pic: ImageResult = {
          url: lead.url,
          thumb: lead.thumb,
          title: lead.title,
          source: [lead.description, wikiRow.snippet].filter(Boolean).join(' — ').slice(0, 300),
          license: 'source',
          credit: 'wikipedia.org',
        };
        results = { ...results, images: [pic, ...results.images] };
        console.log(JSON.stringify({ zo: 'entity', wikiLeadImage: true, title: lead.title }));
      }
    }
  }
  send('search', results);
  const boost = imageBoost(pattern, results, env, scope, boostQuery);
  const crypto = cryptographyHint(query, results.results);
  await design(send, env, { query, pattern, depth: plan.depth, readPages: plan.readPages || deep || fromSeeds, search: results, context: [designContext, crypto].filter(Boolean).join('\n') || undefined, intent: u?.intent, deep, boost, entityHint, ticker: quote ? tickerNode(quote) : undefined, earlyBrief, website }, started, scope, late);
}

/** The profile on the card, wherever the layout put it, links the person's own website. */
function withWebsite(node: CardNode, website: number): CardNode {
  if (node.type === 'profile') return { ...node, website };
  if ('children' in node && Array.isArray(node.children)) return { ...node, children: node.children.map((c) => withWebsite(c, website)) } as CardNode;
  return node;
}

const SITE_WAIT_MS = 700;
const SCHOLARLY_HOST = /(^|\.)(scholar\.google|openreview|semanticscholar|researchgate|arxiv|alphaxiv|dblp|orcid)\./i;

/** Researchers list their site on ORCID; anyone else's is guessed from the name and checked against the ask. */
function lookupOwnSite(query: string): Promise<SearchResult | undefined> {
  const name = personSubject(query);
  const terms = contextTerms(query);
  if (RESEARCH_ASK.test(query)) return orcidSite(name, terms);
  return probeOwnSite(name).then((candidates) => pickOwnSite(candidates, name, terms));
}

/**
 * The person's own website: from the kept rows when the engines found it, else the lookup started with
 * the search. A bare "who is" whose rows are scholar profiles asks ORCID now, with the kept person's terms.
 */
async function ownSiteFor(query: string, entity: Entity, rows: SearchResult[], lookup: Promise<SearchResult | undefined> | undefined): Promise<SearchResult | undefined> {
  const asked = personSubject(query);
  const name = asked.split(/\s+/).length >= 2 ? asked : entity.name;
  const found = rows.find((r) => isOwnSite(name, r));
  if (found) return found;
  const late = lookup ?? (rows.some((r) => SCHOLARLY_HOST.test(domainOf(r.url))) ? orcidSite(name, entity.terms) : undefined);
  if (!late) return undefined;
  return Promise.race([late, new Promise<undefined>((r) => setTimeout(() => r(undefined), SITE_WAIT_MS))]);
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
  const refLine = req.ref ? refContext(req.ref) : '';
  const context = scrubLeak([req.context?.slice(0, 4000), refLine].filter(Boolean).join('\n')) || undefined;
  const from = req.cards.find((c) => c.id === req.from);

  // Writing ("draft an email") is answered directly. A planner that calls it a search, then a rewriter,
  // is what turned "Draft the unblock email" into a lookup for the paper title and a banned IP address.
  if (req.intent !== 'search' && req.intent !== 'adjust' && isWritingAsk(req.question)) {
    const plan = quickPlan(req.question, 'chat');
    send('plan', plan);
    await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'chat', question: req.question }, context }, started, scope);
    return;
  }

  // A search button on a card: always resolve it against the conversation ("apple varieties" → "best apples for apple pie").
  if (req.intent === 'search') {
    // Card/control prompts (incl. Which-one? choice.query) are already the search string — do not LLM-rewrite.
    const picked = req.question.trim();
    // "None of these" sends "Name, detail". That detail is the new identity ("Capital One"),
    // not a fragment to mix with the company the namesake list failed to match.
    const detail = commaDetailQuery(picked);
    if (detail) {
      const chosen = `Chosen person: ${personSubject(picked)}`;
      const pickContext = [topicOnly(req.context), refLine].filter(Boolean).join('\n') || undefined;
      send('rewrite', { query: detail });
      await searchAndDesign(send, env, detail, 'any', [chosen, pickContext].filter(Boolean).join('\n'), started, scope, true);
      return;
    }
    // A Which-one? pick keeps what the ask was about ("jaylen brown injuries" → that person's injuries, not
    // their profile): search the person and the topic, with the pick locked as the thread's chosen person.
    const person = isPersonAsk(picked);
    const topic = person ? pickTopic(picked, [...askedQuestions(req.context), req.original]) : '';
    // A picked person starts clean: the cards before it were about someone else or a list of people.
    const pickContext = person ? [topicOnly(req.context), refLine].filter(Boolean).join('\n') || undefined : context;
    if (topic) {
      const query = pickTopicQuery(picked, topic);
      const label = pickSeeds(picked, req.search?.results ?? []).label;
      const chosen = `Chosen person: ${personSubject(picked)}${label ? ` — ${label}` : ''}`;
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', [chosen, pickContext].filter(Boolean).join('\n'), started, scope, true, req.search?.results);
      return;
    }
    const query = picked;
    send('rewrite', { query });
    // EN4 part 8: the rows that produced these choices come along, so the pick never comes back empty.
    await searchAndDesign(send, env, query, 'any', pickContext, started, scope, true, req.search?.results);
    return;
  }

  // A person thread steered by the asker: "not this" offers the other people with that name, and
  // "from BlueFlame AI" searches that one. The normal rewrite kept the person on screen either way.
  const steer = req.intent !== 'adjust' ? personSteer(req.question) : undefined;
  const person = steer ? threadPerson(req.original, req.context) : '';
  if (steer && person) {
    const base = topicOnly(withoutChosen(context));
    if (steer.kind === 'narrow') {
      const query = `${person}, ${steer.detail}`;
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', [`The person means the ${person} connected to ${steer.detail}, not anyone on the earlier cards.`, base].filter(Boolean).join('\n'), started, scope, true);
      return;
    }
    const query = `Who is ${person}`;
    const shown = from?.card ? [from.card.title, from.card.subtitle].filter(Boolean).join(' — ') : from?.title ?? '';
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'any', base, started, scope, true, undefined, {
      avoid: new Set((req.search?.results ?? []).map((r) => normalizeUrl(r.url))),
      rejected: shown || person,
    });
    return;
  }

  // "That's not today's": re-run the ask the card answered on today's results only, never a reworded
  // search of the complaint (live "AI news today" → "not today's" → a stock-market card).
  if (req.intent !== 'adjust' && staleComplaint(req.question)) {
    const query = askedQuestions(req.context)[0] ?? req.original;
    const recent = 'The person said the last answer was not current: use only items from the past 24 hours, say when each happened, and if nothing that recent was found, say so plainly instead of repeating older items.';
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'day', [recent, context].filter(Boolean).join('\n'), started, scope, true);
    return;
  }

  // Classify and speculatively rewrite at the same time; the rewrite is only used if Jev says a new search is needed.
  const rewritten = req.intent === 'adjust' || standsAlone(req.question)
    ? Promise.resolve(req.question)
    : rewriteQuery(req.original, req.question, env, context, from?.title).catch(() => req.question);
  const plan = await planLayout(req.question, env, { original: req.original, cards: req.cards.map(({ id, title }) => ({ id, title })), context });
  const mode = req.intent === 'adjust' ? 'refine' : req.intent === 'ask' && plan.mode === 'refine' ? 'answer' : plan.mode ?? 'chat';

  switch (mode) {
    case 'search': {
      send('plan', plan);
      const query = faithfulQuery(req.question, withRef(await rewritten, req.ref));
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', context, started, scope, true, req.ref ? req.search?.results : undefined);
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

const TIMED_EVENTS = new Set(['intent', 'plan', 'search', 'designing', 'head', 'node']);

export interface StreamOpts {
  request?: Request;
  /** Signed-in ask (gate userId). Signed-out asks draw on at most SERPER_ANON_SHARE of the Serper prod day. */
  signedIn?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The person's own words with straight quotes, so "Who’s Ricky" reads like "Who's Ricky". */
function plainRequest(req: StreamRequest): StreamRequest {
  const context = req.context === undefined ? undefined : plainQuotes(req.context);
  switch (req.kind) {
    case 'search':
    case 'design':
      return { ...req, query: plainQuotes(req.query), context };
    case 'followup':
      return { ...req, question: plainQuotes(req.question), original: plainQuotes(req.original), context };
    default: {
      const unreachable: never = req;
      return unreachable;
    }
  }
}

export async function runStream(raw: StreamRequest, env: Env, rawSend: Send, opts?: StreamOpts): Promise<void> {
  const started = Date.now();
  const req = plainRequest(raw);
  const ledger = newLedger();
  // Provider and model names never reach the client (t432); the model goes to the server log.
  ledger.stages = { at: started, ms: {} };
  const send: Send = (event, data) => {
    if (TIMED_EVENTS.has(event)) mark(ledger, event);
    if (event === 'done' && data && typeof data === 'object') data = { ...data, t: ledger.stages?.ms };
    const out = publicEvent(event, data);
    if (out.via) ledger.via = out.via;
    rawSend(event, out.data);
  };
  ledger.force = opts?.request ? testForce(opts.request, env) : undefined;
  if (opts && !opts.signedIn) ledger.serperShare = SERPER_ANON_SHARE;
  const scope: AskScope = {
    ledger,
    bypass: opts?.request ? cacheBypass(opts.request, env) : false,
    refresh: opts?.request ? wantsRefresh(opts.request) : false,
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
