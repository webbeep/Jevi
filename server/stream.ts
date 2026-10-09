import { DEEP_PAGES, routeExtras, routeOf } from './router';
import { serperImages } from './cascade';
import { publicEvent } from './publicPayload';
import {
  askTopic,
  askedQuestions,
  contextTerms,
  distinguishingTerms,
  entityContextLine,
  entityHintFor,
  isDisambiguationPage,
  isPersonAsk,
  knowledgeForKept,
  knowledgeRow,
  nameIsTopic,
  personSourceOk,
  personSubject,
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
import type { AnswerCard, FollowupContext, FollowupIntent, LayoutPlan } from '../shared/card';
import { type AskRef, refContext, withRef } from '../shared/askAbout';
import type { EngineStatus, Freshness, ImageResult, SearchResponse, SearchResult } from '../shared/types';
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
import { entityQuery, relaxQuery, tickerQueries } from './queryClean';
import { type LateExtras, searchWithLate } from './search';
import { scholarlyResults, withScholarly } from './scholarly';
import { videoResults, withVideos } from './videoSearch';
import type { Send } from './sse';
import { extraQueries, understand } from './understand';
import { cacheBypass, testForce, validTestToken } from './token';
import { SERPER_ANON_SHARE } from './providerCap';
import type { Env } from './util';

const FRESH_DAY = /\b(today|tonight|yesterday|right now|live|breaking|score[sd]?)\b/i;
const FRESH_WEEK = /\b(news|latest|this week|recent(?:ly)?|headlines)\b/i;

/** Freshness the literal search can take from the ask's own words, before the intent read lands. */
export function guessFreshness(query: string): Freshness {
  if (FRESH_DAY.test(query)) return 'day';
  if (FRESH_WEEK.test(query)) return 'week';
  return 'any';
}

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
async function searchAndDesign(send: Send, env: Env, query: string, freshness: Freshness, context: string | undefined, started: number, scope: AskScope, rewritten = false, seedRows?: SearchResult[]) {
  const understood = rewritten ? Promise.resolve(undefined) : understand(query, env, context);
  const planned = understood.then((u) => planLayout(query, env, { intent: u?.intent })).then((plan) => {
    send('plan', plan);
    return plan;
  });

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
  const instant = tickerQueries(query);
  if (!rewritten) {
    // SPD2 (t457): every ask searches its literal words at once; the understood rewrites join the same
    // engine when the intent read lands (~1 s), instead of the whole search waiting for it. A time-sensitive
    // ask takes its literal freshness from its own words; the rewrites use the intent read's.
    const literalFresh = freshness === 'any' ? guessFreshness(query) : freshness;
    const later = understood.then((x) => {
      if (x) send('intent', { intent: x.intent, queries: x.queries });
      return { more: routeExtras(route, moreQueries(query, [...instant, ...extraQueries(query, x)])), freshness: freshness === 'any' ? x?.freshness ?? literalFresh : freshness };
    });
    found = await searchWithLate({ q: queriesForAsk(query, []), later, freshness: literalFresh, count: 20, waitExtras: deep }, env, scope);
    u = await understood;
  } else {
    u = undefined;
    // Literal question first. Planner rewrites are the later calls, still inside the cap.
    const q = queriesForAsk(query, instant);
    const more = routeExtras(route, moreQueries(query, instant));
    found = await searchWithLate({ q, more, freshness: freshness === 'any' ? guessFreshness(query) : freshness, count: 20 }, env, scope);
  }
  let results = applyPickGate(query, applyRelevance(query, { ...found.response, query }, scope.ledger));
  const scholar = await scholarly;
  if (scholar.length) results = { ...results, results: withScholarly(scholar, results.results) };
  const clips = await videos;
  if (clips.length) results = { ...results, results: withVideos(clips, results.results) };
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
      const entity = (person && person.toLowerCase() !== query.trim().toLowerCase() ? person : '') || entityQuery(query);
      const lower = entity.toLowerCase();
      if (entity && lower !== query.trim().toLowerCase() && lower !== relaxed.toLowerCase()) {
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
        } else if (pickPerson) {
          // EN4 part 8: the tap that offered these choices is still in hand, so re-ask on the rows
          // behind the picked choice before offering the same choices again (live "Ray Lee Raycon
          // Founder" → the LinkedIn/ZoomInfo rows, never "No results for this search").
          const seeds = seedRows?.length && isPersonAsk(query) ? pickSeeds(query, seedRows) : undefined;
          if (seeds?.seeds.length) {
            results = { ...results, results: seeds.seeds.map((i) => seedRows![i]!), knowledge: undefined };
            fromSeeds = true;
            recovered = 'seeds';
            console.log(JSON.stringify({ zo: 'entity', pickSeeds: seeds.seeds.length, label: seeds.label }));
          } else if (!seedRows?.length) {
            // Nothing about the asker's person: re-ask on the bare name and let them pick.
            const decision = resolveEntity(`Who is ${person}`, again.response.results, { pattern: 'profile' });
            if (decision.kind === 'choices') {
              scope.ledger.entity = { kind: 'choices', choices: decision.choices.length };
              send('search', { ...again.response, query });
              // Choices ride on the done event (FE readChoices() in shared/choices.ts); never cached.
              send('done', {
                engine: 'extractive',
                removed: 0,
                pagesRead: 0,
                ms: Date.now() - started,
                choices: publicChoices(decision.choices),
              });
              console.log(JSON.stringify({ zo: 'entity', pickNoMatch: true, rechoices: decision.choices.length }));
              return;
            }
          }
        }
        if (person) console.log(JSON.stringify({ zo: 'entity', nameFallback: true, kept: picked.length, gatedOut }));
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
        console.log(JSON.stringify({ zo: 'entity', pickEmpty: true }));
        send('search', { ...results, results: [] });
        send('head', { title: subject, subtitle: label });
        send('node', {
          index: 0,
          node: { type: 'text', text: `I couldn't find more about ${subject}${label ? ` (${label})` : ''} right now.`, size: 'lg' },
        });
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
  if (isPersonAsk(query, plan.pattern) && !contextTerms(query).length && !priorEntity(context) && !nameIsTopic(query, results.results)) {
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
  const decision = resolveEntity(query, results.results, { pattern: plan.pattern, prior: priorEntity(context) });
  if (decision.kind === 'choices') {
    scope.ledger.entity = { kind: 'choices', choices: decision.choices.length };
    console.log(JSON.stringify({ zo: 'entity', kind: 'choices', choices: decision.choices.length }));
    send('search', results);
    // Choices ride on the done event (FE readChoices() in shared/choices.ts); never cached.
    send('done', { engine: 'extractive', removed: 0, pagesRead: 0, ms: Date.now() - started, choices: publicChoices(decision.choices) });
    return;
  }
  let designContext = context;
  let entityHint: ((entity: string) => EntityHint | undefined) | undefined;
  let boostQuery = query;
  let pattern = plan.pattern;
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
    designContext = [entityContextLine(decision.entity), context].filter(Boolean).join('\n');
    entityHint = entityHintFor(decision.entity, query);
    // Name + the asker's own context ("Ray Lee BlueFlame AI") pulls that person's photos, not a namesake's.
    boostQuery = contextTerms(query).length ? query : decision.entity.name;
    // Person singles must be profile cards so image boost + row pictures run (Lead GATE: David Kim / BlueFlame had 0 imgs on answer pattern),
    // unless the ask is about something of theirs ("Jaylen Brown injuries"): that keeps the planned layout.
    if (pattern !== 'profile' && !askTopic(query, decision.entity.name)) {
      pattern = 'profile';
      send('plan', { ...plan, pattern });
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
  await design(send, env, { query, pattern, depth: plan.depth, readPages: plan.readPages || deep || fromSeeds, search: results, context: designContext, intent: u?.intent, deep, boost, entityHint }, started, scope, late);
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
  const context = [req.context?.slice(0, 4000), refLine].filter(Boolean).join('\n') || undefined;
  const from = req.cards.find((c) => c.id === req.from);

  // A search button on a card: always resolve it against the conversation ("apple varieties" → "best apples for apple pie").
  if (req.intent === 'search') {
    // Card/control prompts (incl. Which-one? choice.query) are already the search string — do not LLM-rewrite.
    const picked = req.question.trim();
    // A Which-one? pick keeps what the ask was about ("jaylen brown injuries" → that person's injuries, not
    // their profile): search the person and the topic, with the pick locked as the thread's chosen person.
    const topic = isPersonAsk(picked) ? pickTopic(picked, [...askedQuestions(req.context), req.original]) : '';
    if (topic) {
      const query = pickTopicQuery(picked, topic);
      const label = pickSeeds(picked, req.search?.results ?? []).label;
      const chosen = `Chosen person: ${personSubject(picked)}${label ? ` — ${label}` : ''}`;
      send('rewrite', { query });
      await searchAndDesign(send, env, query, 'any', [chosen, context].filter(Boolean).join('\n'), started, scope, true, req.search?.results);
      return;
    }
    const query = picked;
    send('rewrite', { query });
    // EN4 part 8: the rows that produced these choices come along, so the pick never comes back empty.
    await searchAndDesign(send, env, query, 'any', context, started, scope, true, req.search?.results);
    return;
  }

  // Classify and speculatively rewrite at the same time; the rewrite is only used if Jev says a new search is needed.
  const rewritten = req.intent === 'adjust' ? Promise.resolve(req.question) : rewriteQuery(req.original, req.question, env, context, from?.title).catch(() => req.question);
  const plan = await planLayout(req.question, env, { original: req.original, cards: req.cards.map(({ id, title }) => ({ id, title })), context });
  const mode = req.intent === 'adjust' ? 'refine' : req.intent === 'ask' && plan.mode === 'refine' ? 'answer' : plan.mode ?? 'chat';

  switch (mode) {
    case 'search': {
      send('plan', plan);
      const query = withRef(await rewritten, req.ref);
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
  /** Signed-in ask (gate userId). Signed-out asks draw on at most SERPER_ANON_SHARE of the Serper prod day. */
  signedIn?: boolean;
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
  if (opts && !opts.signedIn) ledger.serperShare = SERPER_ANON_SHARE;
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
