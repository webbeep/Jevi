import { DEEP_PAGES, routeOf } from './router';
import { serperImages } from './cascade';
import { playerStatRow } from './playerLine';
import { publicEvent } from './publicPayload';
import {
  askTopic,
  askedQuestions,
  contextTerms,
  correctedPersonQuery,
  spellingQuery,
  distinguishingTerms,
  vowelSwap,
  entityContextLine,
  type Entity,
  type EntityChoice,
  type EntityDecision,
  entityHintFor,
  formalNameQueries,
  workplaceQueries,
  isDisambiguationPage,
  isPersonAsk,
  personCardTitle,
  knowledgeForKept,
  knowledgeRow,
  middleInitialPerson,
  nameIsTopic,
  hasFullPersonName,
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
import { fetchWikiArticle, fetchWikiDisambiguation, fetchWikiLeadImage } from './wikiSearch';
import { type EntityHint, mentionsAny } from './imageGate';
import type { RowImagePlan } from './pictures';
import type { AnswerCard, CardNode, FollowupContext, FollowupIntent, LayoutPlan } from '../shared/card';
import { type AskRef, cardSearchQuery, plainFollowup, refContext, topicOf, usefulFollowups, withRef } from '../shared/askAbout';
import { QUOTE_MAX } from '../shared/quoteAsk';
import type { EngineStatus, Freshness, ImageResult, SearchResponse, SearchResult } from '../shared/types';
import { rewriteQuery } from './ai';
import { type DesignRequest, designParallel, designStream, gateNode } from './design';
import { BRIEF_ROWS, briefSources, remapBrief, type SourceBrief } from './brief';
import { groundMembers } from './claims';
import { abstainComputed, alignFactProse, cardFacts, factAnswer, hasMemberWork, hopQueries, leadMemberRows, nextHop, placeFactLead, unsupportedYear } from './hops';
import { gapQuery, onTopicCount, rescueQuery, sourcesMiss } from './rescue';
import { keepPictures, reviewCard, type Review } from './review';
import { permitted } from './images';
import { hasLlm } from './llm';
import { collectPages, ogImageOf } from './pages';
import { MADE_PATTERNS, compareSideQueries, heuristicPattern, skeletonCard } from './patterns';
import { planLayout } from './plan';
import type { AskScope, CallLedger } from './budget';
import { SEARCH_CALL_CAP, logAsk, mark, moreQueries, newLedger, queriesForAsk, searchCalls } from './budget';
import { gateResults } from './relevanceGate';
import { entityQuery, plainQuotes, relaxQuery, tickerQueries } from './queryClean';
import { type LateExtras, normalizeUrl, searchWithLate } from './search';
import type { WebHit } from './cascade';
import { domainOf } from './util';
import { choicesIn, distinctActions, subjectWords } from './chips';
import { anchoredFollowup, asksToCompare, cryptographyHint, faithfulQuery, isWritingAsk, needsOwnSearch, ownQuestion, personQuestion, quickPlan, quoteFollowQuery, scrubLeak, standsAlone, withoutLeakActions, withoutRepeatedCallouts } from './askGuard';
import { calculationAnswer, isCalculationAsk } from './calculate';
import { comparisonRepair, comparisonTitle } from './compareAnswer';
import { withFinishedSentences } from './polish';
import { queryWithPlace, readerPlace, settleReadings } from './readings';
import { isKeepOnly, keptBody } from './refine';
import { finishQuality, hasOfficialHit, hostTier, officialProbe, preferSources, sinkFormatWords } from './sourceQuality';
import { isOwnSite, orcidSite, pickOwnSite, probeOwnSite, RESEARCH_ASK, withOwnSite } from './ownSite';
import { quoteAsk } from '../shared/quoteAsk';
import { dropStrayDois, isPaperAsk, leadPreprints, scholarlyResults, withScholarly } from './scholarly';
import { recallClips, wantsVideo, withProductClips, withVideos } from './videoSearch';
import { guessFreshness, preferFresh, staleComplaint, stricter } from './freshness';
import { isQuoteRow, liveQuote, quoteRow, tickerNode } from './liveQuote';
import { findTicker } from '../shared/tickerNotes';
import { splitPeople } from './peopleSplit';
import { personSteer, pronounFollow, roleFollow, threadPerson, topicOnly, withoutChosen } from './personSteer';
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
  /** The one person a profile card is about: its pictures and its snippet-only fallback are about them alone. */
  person?: { name: string; role?: string; org?: string };
  /** A price card's lead: the live price and chart, built from the quote feed. */
  ticker?: CardNode;
  /** The source check, started on the literal search's rows while the rewrites were still searching. */
  earlyBrief?: Promise<EarlyBrief | undefined>;
  /** A search that just ran. A wrong result set gets one different search before the card says nothing was found. */
  allowRescue?: boolean;
  /** Rows a fact hop just added. A replacing rescue must not drop them before they are read. */
  hopUrls?: string[];
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
    person: req.person?.name,
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
const pageBudget = (readPages: boolean) => (readPages ? { count: 5, need: 3, budgetMs: 1600 } : { count: 3, need: 2, budgetMs: 800 });

/**
 * How long to keep waiting for the picture search after pages are in. That search started when the
 * results were sent, so it has already overlapped the source check and the page reads. A short grace
 * lets a straggler into the prompt; pictures that land later still fill blank rows from the same promise.
 */
const BOOST_GRACE_MS = 200;

/** The model is scored against the person's question, including hits a looser retry brought back. */
function applyRelevance(query: string, response: SearchResponse, ledger: CallLedger): SearchResponse {
  const gated = gateResults(query, response.results);
  ledger.relevanceDropped = (ledger.relevanceDropped ?? 0) + gated.dropped;
  const ranked = preferSources(query, gated.kept);
  const changed = ranked.length !== response.results.length || ranked.some((row, i) => row !== response.results[i]);
  return changed ? { ...response, results: ranked } : response;
}

/**
 * EN4 pick gate: an ask that names an org/role ("Ray Lee BlueFlame AI", "David Kim C2 founder")
 * keeps only rows about that very person, so a namesake's page can never seed the card or a
 * choice label. When everything drops, the empty-results recovery runs instead.
 */
function applyPickGate(query: string, response: SearchResponse): SearchResponse {
  if (!isPersonAsk(query) || !distinguishingTerms(query).length || nameIsTopic(query, response.results)) return response;
  // A given name plus a workplace is not one person yet. The full-name gate would drop
  // every row, and the ask could never choose between the people the sources name.
  const name = personSubject(query);
  if (name && !/\s/.test(name)) return response;
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

/**
 * When the question names an agency or asks a place for a count or a rule, and that
 * site is missing from the results, one more search looks for it. Ranking cannot
 * lead with a page the engines never returned.
 */
/** The pages already spell a mistyped word. The card keeps the results; the label says so. */
function noteSpelling(send: Send, typed: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): void {
  const fixed = spellingQuery(typed, rows);
  if (fixed) send('rewrite', { query: fixed, spelling: true });
}

/** Words already on the card that tell this person from someone else with the same name. */
function personCue(card: AnswerCard | undefined): string {
  if (!card) return '';
  const bits: string[] = [];
  if (card.subtitle) bits.push(card.subtitle);
  const walk = (nodes: readonly CardNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'profile' && node.subtitle) bits.push(node.subtitle);
      if ('children' in node && Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(card.body);
  return bits.join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

type OfficialSearch = Awaited<ReturnType<typeof searchWithLate>>;

/** The agency or place search, started with the literal one so the card does not wait for it after the main search. */
function startOfficial(query: string, env: Env, scope: AskScope): Promise<OfficialSearch | undefined> | undefined {
  const probe = officialProbe(query);
  if (!probe) return undefined;
  // Its own call slot, so the rewrites keep theirs.
  scope.ledger.bonus = (scope.ledger.bonus ?? 0) + 1;
  return searchWithLate({ q: probe, freshness: 'any', count: 6, lite: true }, env, scope).catch(() => undefined);
}

async function attachOfficial(query: string, results: SearchResponse, env: Env, scope: AskScope, early?: Promise<OfficialSearch | undefined>): Promise<SearchResponse> {
  if (!results.results.length || hasOfficialHit(query, results.results)) return results;
  const probe = officialProbe(query);
  if (!probe) return results;
  let extra = early ? await early : undefined;
  if (!extra) {
    const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
    if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + 1;
    extra = await searchWithLate({ q: probe, freshness: 'any', count: 6, lite: true }, env, scope);
  }
  const add = extra.response.results.filter((row) => !results.results.some((have) => have.url === row.url));
  if (!add.length) return results;
  console.log(JSON.stringify({ zo: 'official', added: add.length, lead: add[0]?.domain }));
  return { ...results, results: preferSources(query, [...add, ...results.results]) };
}

/** One more search, only when its rows are actually about the goal. The old "missing" note is not reused: its source numbers belonged to the rows that were wrong. */
async function rescueSources(send: Send, env: Env, req: DesignArgs, brief: SourceBrief, scope: AskScope): Promise<{ search: SearchResponse; brief: SourceBrief } | undefined> {
  const alt = rescueQuery(req.query, brief);
  if (!alt) return undefined;
  const before = onTopicCount(req.search.results, brief);
  const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
  if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - room);
  const again = await searchWithLate({ q: alt, freshness: req.search.freshness === 'any' ? guessFreshness(req.query) : req.search.freshness, count: 12, lite: true }, env, scope);
  const gated = applyRelevance(alt, { ...again.response, query: alt }, scope.ledger);
  const after = onTopicCount(gated.results, brief);
  console.log(JSON.stringify({ zo: 'rescue', alt, before, after, kept: gated.results.length }));
  if (!(after > before) || !gated.results.length) return undefined;
  send('peek', gated.results.slice(0, PEEK_ROWS).map(({ title, url, domain, date }) => ({ title, url, domain, date })));
  send('search', gated);
  const next = await briefSources({ query: req.query, intent: req.intent, context: req.context, results: gated.results, isLive: isQuoteRow, shown: req.ticker ? TICKER_SHOWN : undefined }, env, 1200);
  return { search: gated, brief: next ?? { goal: brief.goal, use: [], stale: [], offTopic: [], conflicts: [] } };
}

/**
 * The encyclopedia extract already answers a person, and an official scoreboard snippet already
 * has the number. Waiting on more page reads is what held the card back.
 */
function pagesCanWait(req: DesignArgs): boolean {
  if (isPersonAsk(req.query) && (req.search.knowledge?.extract?.length ?? 0) > 180) return true;
  if (heuristicPattern(req.query) !== 'briefing' || guessFreshness(req.query) !== 'day') return false;
  return req.search.results.slice(0, 5).some((row) => hostTier(row.domain) === 0 && /\d/.test(`${row.title} ${row.snippet}`));
}

async function design(send: Send, env: Env, req: DesignArgs, started: number, scope: AskScope, late?: Promise<LateExtras>) {
  // Follow-ups keep the sources already gated for the original question.
  if (!req.followup) {
    const before = req.search.results;
    const gated = applyRelevance(req.query, req.search, scope.ledger);
    const lead = factAnswer(req.query, before.map((row) => `${row.title} ${row.snippet ?? ''}`).join('\n'))?.lead;
    const kept = new Set(gated.results.map((row) => row.url));
    const want = new Set(req.hopUrls ?? []);
    // Hop rows, and any row that states the implied figure, stay at the front so they are read.
    const carry = before.filter((row) => !kept.has(row.url) && (want.has(row.url) || (lead ? `${row.title} ${row.snippet ?? ''}`.toLowerCase().includes(lead.toLowerCase()) : false)));
    const merged = [...carry, ...gated.results];
    const hopped = merged.filter((row) => want.has(row.url));
    const rest = merged.filter((row) => !want.has(row.url));
    req = { ...req, search: { ...gated, results: leadMemberRows(req.query, [...hopped, ...rest], [...want]) } };
  }
  // Cards already on screen point into this search's image list by index, so only a new search may reorder it.
  const newSearch = !req.followup;
  // Writing and code are made for the person, not looked up, so they are composed like a conversation turn.
  if (!req.followup && MADE_PATTERNS.has(req.pattern)) req = { ...req, followup: { mode: 'chat', question: req.query } };
  // Conversation turns reason from what is already known; everything else reads pages first.
  const chat = req.followup?.mode === 'chat';
  const skipReads = !chat && !req.followup && !req.deep && pagesCanWait(req);
  const budget = chat
    ? { count: 3, need: 0, budgetMs: 0 }
    : skipReads
      ? { count: 0, need: 0, budgetMs: 0 }
      : req.deep
        ? DEEP_PAGES
        : pageBudget(req.readPages);
  // Usually it already ran on the literal search's rows while the rewrites were searching.
  const briefing = !newSearch || chat || isPaperAsk(req.query) ? undefined
    : req.earlyBrief ? req.earlyBrief.then((early) => early ? remapBrief(early.brief, early.judged, req.search.results) : undefined)
    : briefSources({ query: req.query, intent: req.intent, context: req.context, results: req.search.results, isLive: isQuoteRow, shown: req.ticker ? TICKER_SHOWN : undefined }, env);
  // Page reads overlap the source check. A rescue throws those pages away and reads the new rows.
  const reading = collectPages(req.search.results, env, budget, late, scope, req.query);
  const briefWait = skipReads && briefing
    ? Promise.race([briefing, new Promise<SourceBrief | undefined>((resolve) => setTimeout(() => resolve(undefined), 400))])
    : briefing;
  let brief = await briefWait?.finally(() => mark(scope.ledger, 'brief'));
  if (brief) console.log(JSON.stringify({ zo: 'brief', use: brief.use.length, stale: brief.stale, offTopic: brief.offTopic, conflicts: brief.conflicts.length, missing: !!brief.missing }));
  let rescued = false;
  let reread = false;
  const implied = factAnswer(req.query, req.search.results.map((row) => `${row.title} ${row.snippet ?? ''}`).join('\n'));
  // A replacing rescue is for the wrong subject. It must not drop the hop page that states the missing fact.
  if (req.allowRescue && brief && !chat && !implied && !req.hopUrls?.length && !hasMemberWork(req.query, req.search.results) && sourcesMiss(brief)) {
    const again = await rescueSources(send, env, req, brief, scope);
    if (again) {
      req = { ...req, search: again.search };
      brief = again.brief;
      rescued = true;
      reread = true;
      void reading.catch(() => undefined);
    }
  }
  // A partial set still names a missing fact (the birth year, the later season). Add those rows.
  // Do not throw away the pages that already answer the other half of the question.
  if (req.allowRescue && brief && !chat && !rescued) {
    const alt = gapQuery(req.query, brief);
    if (alt) {
      const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
      if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - room);
      const again = await searchWithLate({ q: alt, freshness: req.search.freshness === 'any' ? guessFreshness(req.query) : req.search.freshness, count: 8, lite: true }, env, scope);
      const gated = applyRelevance(alt, { ...again.response, query: alt }, scope.ledger);
      const add = gated.results.filter((row) => !req.search.results.some((have) => have.url === row.url)).slice(0, 4);
      if (add.length) {
        req = { ...req, search: { ...req.search, results: [...req.search.results, ...add] } };
        send('peek', add.slice(0, PEEK_ROWS).map(({ title, url, domain, date }) => ({ title, url, domain, date })));
        send('search', req.search);
        reread = true;
        void reading.catch(() => undefined);
        console.log(JSON.stringify({ zo: 'gap', alt, added: add.length }));
      }
    }
  }
  const pages = reread ? await collectPages(req.search.results, env, budget, undefined, scope, req.query) : await reading;
  mark(scope.ledger, 'pages');
  const fresh = pages.filter((p) => !req.search.results[p.n - 1]?.content);
  if (fresh.length) send('pages', fresh.map(({ n, url, text }) => ({ n, url, text })));

  // Page preview images and images from engines that answered late are often the most relevant ones.
  const lateImages = !rescued && late ? await Promise.race([late.then((l) => l.images), new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 150))]) : [];
  const boosted = !rescued && req.boost ? await Promise.race([req.boost, new Promise<ImageResult[]>((r) => setTimeout(() => r([]), BOOST_GRACE_MS))]) : [];
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
  const designer = req.followup || quoteCard || req.ticker ? designStream : designParallel;
  const rowImages = chat || quoteCard ? undefined : rowImagePlan(req, env, scope);
  const snippetCorpus = req.search.results.map((row) => `${row.title} ${row.snippet ?? ''}`).join('\n');
  const factCorpus = [
    snippetCorpus,
    ...pages.map((page) => `${req.search.results[page.n - 1]?.title ?? ''} ${page.text}`),
  ].join('\n');
  // A ratio's two lengths sit next to their names in the snippets. Page text often
  // separates them, so a ratio trusts the snippets first.
  const ratio = /\bif\b[\s\S]+?\b(?:took place|were held|was held|happened|ran) on\b/i.test(req.query);
  const facts = ratio
    ? factAnswer(req.query, snippetCorpus) ?? factAnswer(req.query, factCorpus)
    : factAnswer(req.query, factCorpus) ?? factAnswer(req.query, snippetCorpus);
  if (facts) console.log(JSON.stringify({ zo: 'facts', lead: facts.lead }));
  const designReq: DesignRequest = { ...req, pages, brief, facts, context: req.context?.slice(0, 4000), rowImages };
  const shown = new Map<number, CardNode>();
  const subject = subjectWords(req.query, req.followup?.question);
  let head: Omit<AnswerCard, 'body'> | undefined;
  let followups: string[] = [];
  let pendingReview: Promise<Review | undefined> | undefined;
  const sentNode = new Map<number, string>();
  let sentHead = '';
  const questionOf = () => designReq.followup?.question ?? designReq.query;
  // Regions are designed in parallel and cannot see each other, so a reading shows up
  // in every region. Publish the collapsed card, and retitle a local reading with its place.
  const publishReadings = () => {
    const indexes = [...shown.keys()].sort((a, b) => a - b);
    const settled = settleReadings(indexes.map((index) => shown.get(index)), head, questionOf());
    const quality = finishQuality(questionOf(), settled.nodes);
    if (head) {
      if (settled.head) head = { ...head, title: settled.head.title, subtitle: settled.head.subtitle };
      const key = JSON.stringify(head);
      if (key !== sentHead) {
        sentHead = key;
        send('head', head);
      }
    }
    indexes.forEach((index, i) => {
      const node = quality[i] ?? { type: 'stack' as const, children: [] };
      shown.set(index, node);
      const key = JSON.stringify(node);
      if (sentNode.get(index) === key) return;
      sentNode.set(index, key);
      send('node', { index, node });
    });
  };
  const summary = await designer(designReq, env, {
    thinking: () => send('thinking', {}),
    layout: (regions) => send('layout', regions),
    head: (h) => {
      const question = questionOf();
      const locked = designReq.person?.name || priorEntity(designReq.context)?.name;
      // A picked person is titled with their name even when the layout is not already a profile.
      // An ask about something of theirs ("Jensen Huang net worth") keeps that in the title.
      const aboutPerson = !!locked && (designReq.pattern === 'profile' || !!designReq.person || isPersonAsk(question));
      const title = designReq.pattern === 'compare' ? comparisonTitle(question, h.title) : personCardTitle(question, h.title, aboutPerson ? locked : undefined);
      head = title === h.title ? h : { ...h, title };
      publishReadings();
    },
    node: (node, index) => {
      const finished = withFinishedSentences(node);
      if (!finished) return;
      node = finished;
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
      const choices = choicesIn([node]);
      if (choices.length) {
        for (const [at, prior] of shown) {
          if (prior.type !== 'actions') continue;
          const kept = distinctActions(prior, choices, subject);
          if (kept === prior) continue;
          if (kept) shown.set(at, kept);
          else shown.set(at, { type: 'actions', items: [] });
        }
      }
      publishReadings();
    },
    followups: (items) => {
      followups = usefulFollowups(items, head?.title, req.followup?.question ?? req.query);
      if (followups.length) send('followups', followups);
    },
    credit: (credit) => send('credit', credit),
    beginReview: !chat && req.followup?.mode !== 'refine' ? () => {
      pendingReview = reviewCard({
        query: designReq.followup?.question ?? designReq.query,
        context: designReq.context,
        brief: designReq.brief,
        results: designReq.search.results,
        pages: designReq.pages,
        isLive: isQuoteRow,
        head,
        nodes: shown,
        followups,
      }, env);
    } : undefined,
  });
  mark(scope.ledger, 'designed');
  // The review ran while pictures were resolving. Apply it before done when it already
  // landed; otherwise publish the card and correct it in place when the review arrives.
  const arrived = pendingReview
    ? await Promise.race([
        pendingReview.then((review) => ({ ready: true as const, review })),
        Promise.resolve({ ready: false as const, review: undefined }),
      ])
    : { ready: true as const, review: undefined };
  const settleComparison = () => {
    if (designReq.pattern !== 'compare') return;
    const question = designReq.followup?.question ?? designReq.query;
    const title = comparisonTitle(question, head?.title ?? question);
    if (head && title !== head.title) {
      head = { ...head, title };
      send('head', head);
    }
    const patches = comparisonRepair(question, designReq.search, shown);
    if (!patches) return;
    for (const patch of patches) {
      shown.set(patch.index, patch.node);
      send('node', { index: patch.index, node: patch.node });
    }
  };
  const memberSources = () => req.search.results.map((row, i) => {
    const page = pages.find((item) => item.n === i + 1);
    return { title: row.title, url: row.url, text: `${row.snippet ?? ''} ${page?.text ?? ''} ${row.content ?? ''}` };
  });
  const settleFacts = () => {
    const indexes = [...shown.keys()].sort((a, b) => a - b);
    const nodes = indexes.map((index) => shown.get(index)!);
    // A computed figure uses the facts the card already shows. A figure from the raw pages,
    // or a hero the model wrote without those facts, changes from draw to draw.
    const grounded = cardFacts(req.query, nodes);
    if (!grounded) {
      const abstained = abstainComputed(req.query, nodes);
      if (abstained) {
        abstained.forEach((node, i) => {
          if (node === nodes[i]) return;
          const index = indexes[i]!;
          shown.set(index, node);
          send('node', { index, node });
        });
      }
      for (const index of indexes) {
        const node = shown.get(index);
        if (!node || node.type !== 'hero' || !unsupportedYear(req.query, factCorpus, node.value)) continue;
        const next = { ...node, value: 'Not stated' };
        shown.set(index, next);
        send('node', { index, node: next });
        break;
      }
      return;
    }
    const led = placeFactLead(nodes, grounded) ?? nodes;
    const next = alignFactProse(led, grounded) ?? led;
    if (next === nodes) return;
    if (next.length === nodes.length) {
      next.forEach((node, i) => {
        const index = indexes[i]!;
        if (node === nodes[i]) return;
        shown.set(index, node);
        send('node', { index, node });
      });
      return;
    }
    const hero = next[0]!;
    const rest = next.slice(1);
    if (indexes[0] === 0 && shown.has(0)) {
      const free = Math.max(...indexes) + 1;
      const displaced = rest[0] ?? shown.get(0)!;
      shown.set(free, displaced);
      send('node', { index: free, node: displaced });
    }
    rest.forEach((node, i) => {
      if (i === 0 && indexes[0] === 0 && shown.has(0)) return;
      const index = indexes[i];
      if (index === undefined || node === nodes[i]) return;
      shown.set(index, node);
      send('node', { index, node });
    });
    shown.set(0, hero);
    send('node', { index: 0, node: hero });
  };
  const settleMembers = () => {
    const indexes = [...shown.keys()].sort((a, b) => a - b);
    const nodes = indexes.map((index) => shown.get(index)!);
    const next = groundMembers(req.query, nodes, memberSources());
    if (!next) return;
    let extra = Math.max(...indexes, -1);
    next.forEach((node, i) => {
      const index = indexes[i];
      if (index === undefined) {
        extra += 1;
        shown.set(extra, node);
        send('node', { index: extra, node });
        return;
      }
      if (node === nodes[i]) return;
      shown.set(index, node);
      send('node', { index, node });
    });
  };
  if (arrived.ready && arrived.review) applyReview(send, designReq, shown, arrived.review, started);
  settleComparison();
  settleFacts();
  settleMembers();
  publishReadings();
  send('done', { ...summary, pagesRead: pages.length, ms: Date.now() - started });
  if (pendingReview && !arrived.ready) {
    const review = await pendingReview;
    if (review) applyReview(send, designReq, shown, review, started);
    settleComparison();
    settleFacts();
    settleMembers();
    publishReadings();
    mark(scope.ledger, 'reviewed');
  } else if (pendingReview) {
    mark(scope.ledger, 'reviewed');
  }
}

/** The finished card, read once against the goal: wrong nodes are corrected in place. */
function applyReview(send: Send, req: DesignRequest, shown: Map<number, CardNode>, review: Review, started: number) {
  const at = Date.now();
  if (review.followups) send('followups', review.followups);
  let fixed = 0;
  for (const fix of review.fixes) {
    if (shown.get(fix.index)?.type === 'ticker') continue;
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
  const isCallout = (node: CardNode | undefined) => node?.type === 'callout' || (node?.type === 'stack' && node.children.some((child) => child.type === 'callout'));
  const leadWarns = isCallout(lead);
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
async function searchAndDesign(send: Send, env: Env, query: string, freshness: Freshness, context: string | undefined, started: number, scope: AskScope, rewritten = false, seedRows?: SearchResult[], steer?: { avoid: Set<string>; rejected: string }, keepTicker?: CardNode) {
  const located = queryWithPlace(query, scope.place);
  if (located !== query) {
    send('rewrite', { query: located });
    query = located;
  }
  // A paper ask already runs the catalogs, so extras and rescue stay off; the intent read still names the card.
  const paper = isPaperAsk(query);
  const understood = rewritten ? Promise.resolve(undefined) : understand(query, env, context).finally(() => mark(scope.ledger, 'understood'));
  // The layout is chosen from the question itself, so it runs with the search instead of after the intent read.
  const planned = planLayout(query, env, {}).then((plan) => {
    send('plan', plan);
    return plan;
  });

  // Keyless, in parallel with the web search: a price ask is answered from the live quote, not old articles.
  const quoting = liveQuote(query).finally(() => mark(scope.ledger, 'quote'));
  const officialEarly = paper ? undefined : startOfficial(query, env, scope);
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
    const kept = preferSources(query, gateResults(query, hits.map(webRow)).kept);
    send('peek', kept.slice(0, PEEK_ROWS).map(({ title, url, domain, date }) => ({ title, url, domain, date })));
    if (paper) return;
    earlyBrief = quoting.then(async (quote) => {
      const rows = [...(quote ? [quoteRow(quote)] : []), ...kept].slice(0, BRIEF_ROWS);
      const brief = await briefSources({ query, intent: intentNow, context, results: rows, isLive: isQuoteRow, shown: quote ? TICKER_SHOWN : undefined }, env);
      mark(scope.ledger, 'brief');
      return brief && { brief, judged: rows };
    });
  };
  const route = routeOf(query);
  scope.ledger.route = route;
  // Fact hops take the rewrite slots first. A two-fact question spends both, even on the quick route.
  const hopList = paper ? [] : hopQueries(query);
  const withHops = (extras: string[]) => {
    const room = Math.max(route === 'deep' ? 2 : 1, Math.min(hopList.length, 2));
    return moreQueries(query, [...hopList, ...extras]).slice(0, room);
  };
  const deep = route === 'deep';
  let found: Awaited<ReturnType<typeof searchWithLate>>;
  let u: Awaited<typeof understood>;
  // SPD-C4 (t457): paper/DOI asks also read OpenAlex, in parallel with the web search.
  const scholarly = scholarlyResults(query);
  // Watch asks also read YouTube (keyless), in parallel: web results rarely carry a playable video.
  const videos = recallClips(query);
  // A preseason line lives on the player page, which the web results often miss once the main engine is capped.
  const statLine = playerStatRow(query);
  // Searches that need no model ("$rdw" → "RDW stock news today") lead the rewrites.
  const instant = [...tickerQueries(query), ...formalNameQueries(query), ...workplaceQueries(query)];
  const sides = compareSideQueries(query);
  if (!rewritten) {
    // SPD2 (t457): every ask searches its literal words at once; the understood rewrites join the same
    // engine when the intent read lands (~1 s), instead of the whole search waiting for it. A time-sensitive
    // ask takes its literal freshness from its own words; the rewrites use the intent read's.
    const literalFresh = freshness === 'any' ? guessFreshness(query) : freshness;
    const later = understood.then((x) => {
      if (x) send('intent', { intent: x.intent, queries: x.queries });
      return { more: withHops([...sides, ...instant, ...extraQueries(query, x)]), freshness: freshness === 'any' ? x?.freshness ?? literalFresh : freshness };
    });
    // A price ask is answered by the live quote; the rewrites only add the news around it.
    found = await searchWithLate({ q: queriesForAsk(query, []), more: withHops([...sides, ...instant]), later, freshness: literalFresh, count: 20, waitExtras: deep && !paper, extrasCutMs: quoteAsk(query) ? QUOTE_EXTRAS_MS : hopList.length ? 1500 : undefined, onLiteral }, env, scope);
    mark(scope.ledger, 'found');
    u = await understood;
  } else {
    u = undefined;
    // Literal question first. Planner rewrites are the later calls, still inside the cap.
    const q = queriesForAsk(query, instant);
    const more = withHops([...sides, ...instant]);
    found = await searchWithLate({ q, more, freshness: freshness === 'any' ? guessFreshness(query) : freshness, count: 20, extrasCutMs: hopList.length ? 1500 : undefined, onLiteral }, env, scope);
  }
  let results = applyPickGate(query, applyRelevance(query, { ...found.response, query }, scope.ledger));
  // "AI news today" must not lead with last week's launch: past-window rows drop once enough current ones remain.
  const span = freshness !== 'any' ? freshness : stricter(guessFreshness(query), u?.freshness === 'day' || u?.freshness === 'week' ? u.freshness : 'any');
  results = { ...results, results: preferFresh(results.results, span) };
  if (heuristicPattern(query) === 'briefing') results = { ...results, results: sinkFormatWords(query, u?.queries ?? [], results.results) };
  const scholar = await scholarly;
  if (scholar.length) results = { ...results, results: withScholarly(scholar, results.results) };
  results = { ...results, results: leadPreprints(query, results.results) };
  results = { ...results, results: dropStrayDois(query, results.results) };
  results = await attachOfficial(query, results, env, scope, officialEarly);
  const clips = await videos;
  if (clips.length) results = { ...results, results: wantsVideo(query) ? withVideos(clips, results.results) : withProductClips(clips, results.results) };
  const quote = await quoting;
  const live = quote ? quoteRow(quote) : undefined;
  if (live) {
    results = { ...results, results: [live, ...results.results.filter((r) => !isQuoteRow(r))] };
    console.log(JSON.stringify({ zo: 'quote', symbol: quote!.symbol, source: quote!.source, ms: Date.now() - started }));
  }
  // A question that needs another fact keeps searching until that fact is in hand, or the time is gone.
  const hopUrls: string[] = [];
  if (!paper && results.results.length) {
    // A parallel hop that the time cut dropped is still missing, so it can be asked again here.
    results = { ...results, results: leadMemberRows(query, results.results) };
    const asked: string[] = [];
    let left = 2;
    while (left > 0 && Date.now() - started < 5200) {
      const corpus = results.results.slice(0, 12).map((row) => `${row.title} ${row.snippet ?? ''}`).join('\n');
      const beforeLead = factAnswer(query, corpus)?.lead;
      const alt = nextHop(query, corpus, { hosts: results.results.map((row) => row.domain), asked });
      if (!alt) break;
      asked.push(alt.toLowerCase());
      left -= 1;
      const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
      if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - room);
      const again = await searchWithLate({ q: alt, freshness: guessFreshness(query), count: 8, lite: true }, env, scope);
      const gated = applyRelevance(alt, { ...again.response, query: alt }, scope.ledger);
      const add = gated.results.filter((row) => !results.results.some((have) => have.url === row.url)).slice(0, 6);
      if (!add.length) break;
      const promoted = [...add, ...results.results];
      const afterLead = factAnswer(query, promoted.slice(0, 12).map((row) => `${row.title} ${row.snippet ?? ''}`).join('\n'))?.lead;
      // Pages that supplied the missing fact lead, so the card is read from them.
      for (const row of add) hopUrls.push(row.url);
      // The new pages lead so they are the ones read. A later rescue must not throw them away.
      results = { ...results, results: leadMemberRows(query, [...add, ...results.results], add.map((row) => row.url)) };
      send('peek', add.slice(0, PEEK_ROWS).map(({ title, url, domain, date }) => ({ title, url, domain, date })));
      send('search', results);
      console.log(JSON.stringify({ zo: 'hop', alt, added: add.length, domains: add.map((row) => row.domain), lead: afterLead ?? beforeLead }));
    }
  }
  let late: Promise<LateExtras> | undefined = found.late;
  const line = await statLine;
  if (line) {
    const key = normalizeUrl(line.url);
    results = { ...results, results: [line, ...results.results.filter((row) => normalizeUrl(row.url) !== key)] };
  }
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
    // A misspelling is corrected from pages the engines actually returned, including the
    // keyless backup when a keyed engine is at its daily cap. When every provider failed,
    // another search of the same words cannot reveal a spelling.
    if (canRecoverSpelling(firstEngines)) {
      let looked = found;
      let fixed = spellingQuery(query, looked.response.results);
      if (!fixed && !looked.response.results.length) {
        const room = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
        if (room < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - room);
        looked = await searchWithLate({ q: query, freshness: 'any', count: 8, lite: true, ungated: true }, env, scope);
        fixed = spellingQuery(query, looked.response.results);
      }
      if (fixed) {
        send('rewrite', { query: fixed, spelling: true });
        let gated = applyPickGate(fixed, applyRelevance(fixed, { ...looked.response, query: fixed }, scope.ledger));
        let lateHit = looked.late;
        if (!gated.results.length) {
          const againRoom = SEARCH_CALL_CAP + (scope.ledger.bonus ?? 0) - searchCalls(scope.ledger);
          if (againRoom < 1) scope.ledger.bonus = (scope.ledger.bonus ?? 0) + (1 - againRoom);
          const named = await searchWithLate({ q: fixed, freshness: 'any', count: 10, lite: true }, env, scope);
          gated = applyPickGate(fixed, applyRelevance(fixed, { ...named.response, query: fixed }, scope.ledger));
          lateHit = named.late;
        }
        if (gated.results.length) {
          results = gated;
          late = lateHit;
          query = fixed;
          recovered = 'entity';
          console.log(JSON.stringify({ zo: 'spelling', query: fixed, kept: gated.results.length }));
        }
      }
    }
    if (!results.results.length && tryRelaxed) {
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
      // A picked choice's own rows name that person in full even when they word the detail differently.
      const cited = person && distinguishingTerms(query).length
        ? seedRows.filter((row) => personSourceOk(query, row) || (person.includes(' ') && hasFullPersonName(person, row)))
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
  // The layout model is not on this path: waiting for it is what made the picker take a minute.
  const earlyPattern = heuristicPattern(query);
  // Bare person ask: the exact article and, when the SERP lacks one, the disambiguation page.
  // Both are keyless, so the same name resolves the same way when backup engines change.
  const chosenName = priorEntity(context)?.name;
  if (!live && isPersonAsk(query, earlyPattern) && !contextTerms(query).length && (!chosenName || chosenName === personSubject(query)) && !nameIsTopic(query, results.results)) {
    const name = personSubject(query);
    if (name) {
      const needArticle = !results.results.some((r) => {
        try {
          return decodeURIComponent(new URL(r.url).pathname).replace(/_/g, ' ').toLowerCase() === `/wiki/${name.toLowerCase()}`;
        } catch {
          return false;
        }
      });
      const listed = results.results.find((r) => isDisambiguationPage(r));
      const [wiki, article] = await Promise.all([
        // A search snippet often stops before the other person. The extract is the list.
        listed && middleInitialPerson(`${listed.title ?? ''} ${listed.snippet ?? ''}`, name) ? Promise.resolve(null) : fetchWikiDisambiguation(name).catch(() => null),
        needArticle ? fetchWikiArticle(name).catch(() => null) : Promise.resolve(null),
      ]);
      const extra = [article, wiki].filter((hit): hit is NonNullable<typeof hit> => !!hit);
      if (extra.length) {
        scope.ledger.search.wikipedia += extra.length;
        const rows = extra.map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          domain: 'en.wikipedia.org',
          engines: ['wikipedia' as const],
        }));
        const seen = new Set(rows.map((r) => r.url));
        results = { ...results, results: [...rows, ...results.results.filter((r) => !seen.has(r.url))] };
        console.log(JSON.stringify({ zo: 'entity', wikiArticle: !!article, wikiDisambiguation: !!wiki }));
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
  const decision: EntityDecision = live ? { kind: 'skip' } : resolveEntity(query, results.results, { pattern: earlyPattern, prior });
  // Heuristic choices go out immediately. A model pass here waited out a stuck call
  // before the person could tap, which is the slow picker.
  if (!steer && decision.kind === 'choices') {
    noteSpelling(send, query, results.results);
    scope.ledger.entity = { kind: 'choices', choices: decision.choices.length };
    send('search', results);
    send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started, choices: publicChoices(decision.choices) });
    return;
  }
  const plan = await planned;
  // A bare "who is" for someone without an encyclopedia page, whose namesakes the heuristic dropped:
  // the model may still see several people worth offering ("who is Ed Chu" → oncologist, EPA official, CEO).
  const unsure = !steer && decision.kind === 'single' && !prior && decision.dropped.length >= 2 && WHO_ASK.test(query) && !distinguishingTerms(query).length
    && !results.knowledge && !decision.kept.some((i) => /\.wikipedia\.org\//i.test(results.results[i]?.url ?? ''));
  const split = rejectedSplit ?? (unsure ? await splitPeople(decision.entity.name, results.results, env) : undefined);
  if (split) console.log(JSON.stringify({ zo: 'entity', kind: 'choices', choices: split.length, by: 'model-over-single' }));
  if (split) {
    scope.ledger.entity = { kind: 'choices', choices: split.length };
    send('search', results);
    // Choices ride on the done event (FE readChoices() in shared/choices.ts); never cached.
    send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started, choices: publicChoices(split) });
    return;
  }
  noteSpelling(send, query, results.results);
  let designContext = context;
  let entityHint: ((entity: string) => EntityHint | undefined) | undefined;
  let boostQuery = query;
  let pattern = plan.pattern;
  let website: number | undefined;
  let person: DesignArgs['person'];
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
    if (pattern === 'profile') person = { name: decision.entity.name, role: decision.entity.role, org: decision.entity.org };
    // The kept Wikipedia article's own lead image (keyless, 0 Serper). It still goes through the image gate:
    // title/source carry the article title + snippet, so the chosen person's name/org must be on it.
    const wikiRow = results.results.find((r) => /^https:\/\/en\.wikipedia\.org\/wiki\//i.test(r.url) && !isDisambiguationPage(r));
    if (wikiRow && !results.images.some((i) => i.url === wikiRow.url)) {
      const lead = await Promise.race([
        fetchWikiLeadImage(wikiRow.url).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
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
  results = { ...results, results: leadMemberRows(query, leadPreprints(query, results.results), hopUrls) };
  send('search', results);
  const boost = imageBoost(pattern, results, env, scope, boostQuery);
  const crypto = cryptographyHint(query, results.results);
  await design(send, env, { query, pattern, depth: plan.depth, readPages: plan.readPages || deep || fromSeeds, search: results, context: [designContext, crypto].filter(Boolean).join('\n') || undefined, intent: u?.intent, deep, boost, entityHint, person, ticker: quote ? tickerNode(quote) : keepTicker, earlyBrief, website, allowRescue: !isPaperAsk(query), hopUrls }, started, scope, late);
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
/**
 * A capped keyed engine still leaves Wikipedia and the backup engines. A spelling can be read
 * off those pages. A total outage, where every engine failed for a real error, cannot.
 */
function canRecoverSpelling(engines: EngineStatus[]): boolean {
  if (!engines.length) return true;
  const hard = (engine: EngineStatus) => !!engine.error && engine.error !== 'empty' && engine.error !== 'cap-daily';
  return !engines.every(hard);
}

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
  const cleaned = plainFollowup(req.question);
  if (cleaned !== req.question) req = { ...req, question: cleaned };
  // "Watch on YouTube" is a search for the video, even when the button was marked ask.
  if (req.intent === 'ask' && wantsVideo(req.question)) req = { ...req, intent: 'search' };
  const refLine = req.ref ? refContext(req.ref) : '';
  const context = scrubLeak([req.context?.slice(0, 4000), refLine].filter(Boolean).join('\n')) || undefined;
  const from = req.cards.find((c) => c.id === req.from);

  // Writing ("draft an email") is answered directly. A planner that calls it a search, then a rewriter,
  // is what turned "Draft the unblock email" into a lookup for the paper title and a banned IP address.
  if (req.intent !== 'search' && isKeepOnly(req.question)) req = { ...req, intent: 'adjust' };
  if (req.intent !== 'search' && req.intent !== 'adjust' && isWritingAsk(req.question)) {
    const plan = quickPlan(req.question, 'chat');
    send('plan', plan);
    await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'chat', question: req.question }, context }, started, scope);
    return;
  }

  // "Keep only …" filters the list already on the card. A new design dropped its sources.
  if (req.intent === 'adjust' && isKeepOnly(req.question)) {
    const priorCard = from?.card ?? [...req.cards].reverse().find((c) => c.card)?.card;
    if (priorCard) {
      const corpus = [JSON.stringify(priorCard), ...(req.search?.results ?? []).map((row) => `${row.title} ${row.snippet} ${row.content ?? ''}`)].join('\n');
      const body = keptBody(priorCard.body, req.question, corpus);
      const plan = quickPlan(req.original, 'answer');
      send('plan', { ...plan, mode: 'refine' });
      send('head', { title: priorCard.title, subtitle: priorCard.subtitle });
      body.forEach((node, index) => send('node', { index, node }));
      send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started });
      return;
    }
  }

  // Arithmetic stays on the figures already on the card and in its sources. A new search
  // is what let an unrelated headline become the answer.
  if (req.intent !== 'search' && req.intent !== 'adjust' && isCalculationAsk(req.question)) {
    const priorCard = from?.card ?? [...req.cards].reverse().find((c) => c.card)?.card;
    const priorTitle = priorCard?.title || from?.title;
    const answer = calculationAnswer({ question: req.question, original: req.original, priorTitle, card: priorCard, search: req.search });
    const plan = quickPlan(req.original, 'chat');
    send('plan', { ...plan, mode: 'chat' });
    send('head', { title: answer.title, subtitle: answer.subtitle });
    answer.nodes.forEach((node, index) => send('node', { index, node }));
    send('done', { engine: 'reasoning', removed: 0, pagesRead: 0, ms: Date.now() - started });
    return;
  }

  // "A vs B vs C" is a new question. Answering it from the card already on screen repeats that card
  // under a "Side by side" label. Search the comparison itself; each other side gets its own query.
  if (req.intent !== 'adjust' && asksToCompare(req.question)) {
    const query = req.question.trim();
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'any', context, started, scope, false);
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
    // A Which-one? pick is already the person to search. Any other search button is a short label
    // for this card ("apple varieties" on an apple pie card), so the search keeps that subject.
    const query = person ? picked : cardSearchQuery(picked, askedQuestions(req.context)[0] ?? req.original);
    // The pick is final: it locks the person so the same name never offers another picker.
    const label = person ? pickSeeds(picked, req.search?.results ?? []).label : '';
    const chosen = person && personSubject(picked) ? `Chosen person: ${personSubject(picked)}${label ? ` — ${label}` : ''}` : '';
    send('rewrite', { query });
    // EN4 part 8: the rows that produced these choices come along, so the pick never comes back empty.
    await searchAndDesign(send, env, query, 'any', [chosen, pickContext].filter(Boolean).join('\n') || undefined, started, scope, true, req.search?.results);
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

  // A role ("the ML researcher") is a different person with that name, not another look at the card.
  // A pronoun ("what degrees does he have?") stays on the person already on screen, and does not
  // wait on a planner that can hang.
  const named = threadPerson(req.original, req.context);
  const role = req.intent !== 'adjust' ? roleFollow(req.question, named) : undefined;
  if (role) {
    send('rewrite', { query: role });
    await searchAndDesign(send, env, role, 'any', [`The follow-up names a role of ${named}. Answer about that role, not a different ${named} already on screen.`, topicOnly(context)].filter(Boolean).join('\n'), started, scope, true);
    return;
  }
  const cue = personCue(from?.card);
  const pronoun = req.intent !== 'adjust' ? pronounFollow(req.question, named, cue) : undefined;
  if (pronoun) {
    send('rewrite', { query: pronoun });
    const lock = cue
      ? `This question is about ${named} (${cue}), the person already on screen. A different ${named} is the wrong person.`
      : `This question is about ${named}, the person already on screen.`;
    await searchAndDesign(send, env, pronoun, 'any', [lock, context].filter(Boolean).join('\n'), started, scope, true);
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

  // A person the card never names is a new search. Waiting on the planner, and its chat
  // fallback, was answering that question from the card already on screen.
  const covered = [req.original, from?.title, from?.card?.title, from?.card?.subtitle].filter(Boolean).join('\n');
  if (req.intent !== 'adjust' && needsOwnSearch(req.question, covered)) {
    const query = personQuestion(req.question);
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'any', context, started, scope, false);
    return;
  }

  // A new question that does not point at the card is searched on its own. The previous
  // subject stays out of the query and out of the conversation the search is written from.
  if (req.intent !== 'adjust' && ownQuestion(req.question, covered)) {
    const query = req.question.trim();
    send('rewrite', { query });
    await searchAndDesign(send, env, query, 'any', undefined, started, scope, false);
    return;
  }

  const onScreen = from?.card ?? [...req.cards].reverse().find((card) => card.card)?.card;
  const chart = findTicker(onScreen?.body ?? []);

  // A price or stock ask still gets the live line chart, including when it is a follow-up
  // that only names the attribute ("what's the price") of the instrument already on screen.
  const quoted = req.intent !== 'adjust'
    ? quoteFollowQuery(req.question, [from?.card?.title, from?.title, req.original].filter((part): part is string => !!part))
    : undefined;
  if (quoted) {
    send('rewrite', { query: quoted });
    await searchAndDesign(send, env, quoted, 'any', context, started, scope, true, undefined, undefined, chart);
    return;
  }

  // A long question is searched as written, even when it points back with "that" or "it".
  // The previous card stays in the conversation. The words they typed are the search,
  // not a stub cut to fit a shorter check, and not an answer drawn only from the old pages.
  if (req.intent !== 'adjust' && req.question.trim().length > QUOTE_MAX) {
    await searchAndDesign(send, env, req.question.trim(), 'any', context, started, scope, false, undefined, undefined, chart);
    return;
  }

  // Classify and speculatively rewrite at the same time; the rewrite is only used if Jev says a new search is needed.
  const anchored = req.intent === 'adjust' ? undefined : anchoredFollowup(req.original, req.question);
  const rewritten = anchored || req.intent === 'adjust' || standsAlone(req.question)
    ? Promise.resolve(anchored ?? req.question)
    : rewriteQuery(req.original, req.question, env, context, from?.title).catch(() => req.question);
  const plan = await planLayout(req.question, env, { original: req.original, cards: req.cards.map(({ id, title }) => ({ id, title })), context });
  const mode = req.intent === 'adjust' ? 'refine' : req.intent === 'ask' && plan.mode === 'refine' ? 'answer' : plan.mode ?? 'chat';

  switch (mode) {
    case 'search': {
      send('plan', plan);
      const host = req.cards.find((c) => c.id === req.from);
      const entity = req.ref?.entity ?? topicOf(host?.card?.title) ?? topicOf(host?.title);
      const ref = req.ref ? { ...req.ref, ...(entity ? { entity } : {}) } : undefined;
      const query = faithfulQuery(req.question, withRef(await rewritten, ref));
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', context, started, scope, true, req.ref ? req.search?.results : undefined, undefined, chart);
      return;
    }
    case 'refine': {
      // Adjustments always become a new card; the card they start from stays as it was.
      const base = (req.intent === 'adjust' ? from : req.cards.find((c) => c.id === plan.target)) ?? [...req.cards].reverse().find((c) => c.card);
      const kept = findTicker(base?.card?.body ?? []) ?? chart;
      if (base?.card) {
        const pattern = base.pattern ?? plan.pattern;
        send('plan', { ...plan, mode, pattern });
        send('base', { id: base.id });
        await design(send, env, { query: req.original, pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'refine', question: req.question, baseCard: base.card }, context, ...(kept ? { ticker: kept } : {}) }, started, scope);
        return;
      }
      send('plan', { ...plan, mode: 'chat' });
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: false, search: req.search, followup: { mode: 'chat', question: req.question }, context, ...(chart ? { ticker: chart } : {}) }, started, scope);
      return;
    }
    case 'answer':
    case 'chat':
      send('plan', { ...plan, mode });
      await design(send, env, { query: req.original, pattern: plan.pattern, depth: plan.depth, readPages: plan.readPages, search: req.search, followup: { mode, question: req.question }, context, think: mode === 'chat' && plan.think, ...(chart ? { ticker: chart } : {}) }, started, scope);
      return;
    default: {
      const unreachable: never = mode;
      throw new Error(`Unknown follow-up mode ${unreachable}`);
    }
  }
}

const TIMED_EVENTS = new Set(['intent', 'plan', 'search', 'designing', 'head', 'node']);

function requestCf(request: Request | undefined): { city?: unknown; region?: unknown; regionCode?: unknown } | undefined {
  if (!request || !('cf' in request)) return undefined;
  const cf = (request as { cf?: unknown }).cf;
  if (!cf || typeof cf !== 'object') return undefined;
  return cf as { city?: unknown; region?: unknown; regionCode?: unknown };
}

export interface StreamOpts {
  request?: Request;
  /** Signed-in ask (gate userId). Signed-out asks draw on at most SERPER_ANON_SHARE of the Serper prod day. */
  signedIn?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** The words they typed, when a bare local ask was aimed at their city before the search. */
  typed?: string;
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
    place: readerPlace(requestCf(opts?.request)),
  };
  try {
    switch (req.kind) {
      case 'search':
        if (opts?.typed && opts.typed !== req.query) send('rewrite', { query: req.query });
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
