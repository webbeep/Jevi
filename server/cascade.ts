import { cleanMarkdown } from '../shared/text';
import type { EngineStatus, Freshness, ImageResult } from '../shared/types';
import { ddgBackupOn, fetchBackup } from './backup';
import { SEARCH_ENGINES, callCap, type CallLedger, type SearchEngine, engineDead, failureOf, rememberDead, searchCalls } from './budget';
import { loadSkips, tripSkip } from './engineSkip';
import { SERPER_IMAGES_SHARE, takeSlot, type CapBucket } from './providerCap';
import { HttpStatusError, type Env, clip, domainOf, fetchJson } from './util';
import { gateResults, strongCount } from './relevanceGate';
import { fetchWikiSearch } from './wikiSearch';
import { youKeyedSearch, youKeylessSearch, youKeyPresent } from './youSearch';

const ENGINE_TIMEOUT_MS = 6500;

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  date?: string;
  content?: string;
}

export interface CascadeResult {
  engine: string;
  /** Hits for the literal question. */
  hits: WebHit[];
  /** Planner-query hit lists, in call order. Each stays separate so it can be ranked against its own words. */
  more: { query: string; hits: WebHit[] }[];
  /** Keyless Wikipedia hits to rank after `hits`. Empty when Wikipedia itself answered, or when two planner queries already used the cap. */
  wikiHits: WebHit[];
  images: ImageResult[];
  statuses: EngineStatus[];
}

interface Query {
  q: string;
  /** Planner rewrites. Each is one more call on the engine that already succeeded. */
  more?: string[];
  /** SPD2: rewrites (and their freshness) that arrive while the literal search is already running. */
  later?: Promise<{ more: string[]; freshness: Freshness }>;
  freshness: Freshness;
  count: number;
  /** Always wait for `later` rewrites and their results (deep asks), even when the literal search already answered. */
  waitExtras?: boolean;
}

/** Gated literal hits that make the ask answerable without waiting on a slow intent read. */
const LITERAL_OK = 4;
/** Below this many clearly on-topic rows, a fallback engine's answer gets a second opinion from the next engine. */
const SECOND_OPINION_MIN = 3;
/** A thin list is an honest answer; a long one with few on-topic rows is the engine matching anything. */
const NOISY_ROWS = 8;
/** With a good literal search, rewrites still join if the intent read lands this soon after the cascade starts. */
const EXTRAS_WAIT_MS = 1200;
/** With a good literal search, a rewrite's results are used only if they arrive this soon after the literal ones. */
const EXTRA_RESULTS_WAIT_MS = 1500;

const NO_EXTRAS: { extras: string[]; fresh?: Freshness } = { extras: [] };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Planner rewrites that differ from the literal question, at most two. */
function plannedExtras(q: Query): string[] {
  const base = q.q.replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set([base]);
  const out: string[] = [];
  for (const raw of q.more ?? []) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 2) break;
  }
  return out;
}

const DAYS: Record<Exclude<Freshness, 'any'>, number> = { day: 1, week: 7, month: 30, year: 365 };

const LANG_FRESH: Record<Exclude<Freshness, 'any'>, string> = { day: 'oneDay', week: 'oneWeek', month: 'oneMonth', year: 'oneYear' };
const TBS: Record<Exclude<Freshness, 'any'>, string> = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };

function hasKey(env: Env, name: string): boolean {
  return !!env[name]?.trim();
}

/** Exa `type`. Defaults to fast. `instant` is an env switch for a later replay, not a code default. */
function exaSearchType(env: Env): string {
  const raw = env.EXA_SEARCH_TYPE?.trim();
  return raw || 'fast';
}

async function exaSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const since = q.freshness === 'any' ? undefined : new Date(Date.now() - DAYS[q.freshness] * 86_400_000).toISOString();
  const data = await fetchJson<{
    results?: { title?: string; url: string; publishedDate?: string; image?: string; text?: string; highlights?: string[] }[];
  }>(
    'https://api.exa.ai/search',
    {
      method: 'POST',
      headers: { 'x-api-key': env.EXA_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q.q,
        numResults: 10,
        type: exaSearchType(env),
        contents: { text: { maxCharacters: 6000 } },
        ...(since ? { startPublishedDate: since } : {}),
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  const hits = (data.results ?? []).map((r) => {
    const text = r.text ? cleanMarkdown(r.text) : '';
    return {
      title: r.title || domainOf(r.url),
      url: r.url,
      snippet: clip(r.highlights?.[0] ?? text.replace(/\n/g, ' '), 320),
      date: r.publishedDate,
      image: r.image,
      content: text.length > 300 ? text : undefined,
    };
  });
  return { hits, images: [] };
}

async function tavilySearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{
    results?: { title: string; url: string; content: string; raw_content?: string | null; published_date?: string }[];
    images?: (string | { url: string; description?: string })[];
  }>(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q.q,
          max_results: 10,
          include_images: true,
          time_range: q.freshness === 'any' ? undefined : q.freshness,
        }),
    },
    ENGINE_TIMEOUT_MS,
  );
  return {
    hits: (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: clip(r.content ?? '', 320),
      date: r.published_date,
      content: r.content && r.content.length > 300 ? r.content : undefined,
    })),
    images: (data.images ?? []).map((img) => {
      const url = typeof img === 'string' ? img : img.url;
      return {
        url,
        thumb: url,
        title: typeof img === 'string' ? '' : img.description ?? '',
        source: domainOf(url),
        license: 'source' as const,
        credit: domainOf(url).replace(/^(cdn|images?|img|static|media|assets)\d*\./, ''),
      };
    }),
  };
}

async function langSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{
    code?: number | string;
    msg?: string;
    message?: string;
    data?: { webPages?: { value?: { name?: string; url: string; snippet?: string; text?: string; datePublished?: string | null }[] } };
  }>(
    'https://api.langsearch.com/v1/web-search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LANGSEARCH_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q.q,
        count: 10,
        freshness: q.freshness === 'any' ? 'noLimit' : LANG_FRESH[q.freshness],
        contents: { text: { maxCharacters: 6000 } },
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  if (data.code != null && Number(data.code) !== 200) {
    const msg = data.msg ?? data.message;
    throw new HttpStatusError(Number(data.code), typeof msg === 'string' ? msg : '');
  }
  return {
    hits: (data.data?.webPages?.value ?? []).map((r) => {
      const text = r.text ? cleanMarkdown(r.text) : '';
      return {
        title: r.name || domainOf(r.url),
        url: r.url,
        snippet: clip(r.snippet ?? text, 320),
        date: r.datePublished ?? undefined,
        content: text.length > 300 ? text : undefined,
      };
    }),
    images: [],
  };
}

async function firecrawlSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{
    success?: boolean;
    data?: { title?: string; description?: string; url: string }[];
  }>(
    'https://api.firecrawl.dev/v1/search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q.q,
        limit: 10,
        ...(q.freshness === 'any' ? {} : { tbs: TBS[q.freshness] }),
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  if (data.success === false) return { hits: [], images: [] };
  return {
    hits: (data.data ?? []).map((r) => ({
      title: r.title || domainOf(r.url),
      url: r.url,
      snippet: clip(r.description ?? '', 320),
    })),
    images: [],
  };
}

const AGO = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;
const NAMED_DAY = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i;
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const AGO_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 };

/** Serper's relative dates ("2 days ago") are not ISO. Recency code only understands ISO, so drop what we cannot place. */
function serperDate(raw: string | undefined, now = Date.now()): string | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const ago = AGO.exec(s);
  if (ago) {
    const ms = Number(ago[1]) * AGO_MS[ago[2].toLowerCase()];
    return Number.isFinite(ms) ? new Date(now - ms).toISOString() : undefined;
  }
  const named = NAMED_DAY.exec(s);
  if (named) {
    const month = MONTH_INDEX[named[1].slice(0, 3).toLowerCase()];
    const day = Number(named[2]);
    const year = Number(named[3]);
    if (month === undefined || day < 1 || day > 31) return undefined;
    return new Date(Date.UTC(year, month, day)).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

type SerperPic = { title?: string; link?: string; imageUrl?: string; source?: string };

const httpsOnly = (u?: string): u is string => !!u && /^https:\/\//i.test(u);

/** Pictures Serper already returned (knowledge graph, top stories, inline images): zero extra calls. */
function serperPics(list: (SerperPic | undefined)[]): ImageResult[] {
  return list.flatMap((p) => {
    if (!p || !httpsOnly(p.imageUrl) || !httpsOnly(p.link)) return [];
    const source = domainOf(p.link);
    return [{ url: p.link, thumb: p.imageUrl, title: clip(p.title ?? '', 140), source, license: 'source' as const, credit: source }];
  });
}

/**
 * One Serper /images call for a picture card whose search came back without publisher pictures.
 * Counts against the Serper daily cap (same bucket). Never throws; https originals only.
 */
export async function serperImages(query: string, env: Env, bucket: CapBucket, onCall?: () => void, timeoutMs = 2500): Promise<ImageResult[]> {
  if (!hasKey(env, 'SERPER_API_KEY') || engineDead('serper')) return [];
  if (!(await takeSlot(env, 'serper', bucket, undefined, bucket === 'prod' ? SERPER_IMAGES_SHARE : 1))) return [];
  onCall?.();
  try {
    const data = await fetchJson<{ images?: SerperPic[] }>(
      'https://google.serper.dev/images',
      { method: 'POST', headers: { 'X-API-KEY': env.SERPER_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query.slice(0, 200), num: 10 }) },
      timeoutMs,
    );
    return serperPics(data.images ?? []).slice(0, 8);
  } catch (err) {
    const failure = failureOf(err);
    if (failure.dead) rememberDead('serper');
    return [];
  }
}

async function serperSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{
    organic?: { title: string; link: string; snippet?: string; date?: string; imageUrl?: string }[];
    knowledgeGraph?: { title?: string; imageUrl?: string; website?: string; descriptionLink?: string };
    topStories?: SerperPic[];
    images?: SerperPic[];
  }>(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: { 'X-API-KEY': env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: q.q,
        num: Math.min(q.count, 10),
        ...(q.freshness === 'any' ? {} : { tbs: TBS[q.freshness] }),
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  return {
    hits: (data.organic ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: clip(r.snippet ?? '', 320),
      date: serperDate(r.date),
      image: httpsOnly(r.imageUrl) ? r.imageUrl : undefined,
    })),
    images: serperPics([
      data.knowledgeGraph ? { title: data.knowledgeGraph.title, imageUrl: data.knowledgeGraph.imageUrl, link: data.knowledgeGraph.website ?? data.knowledgeGraph.descriptionLink } : undefined,
      ...(data.topStories ?? []),
      ...(data.images ?? []),
    ]),
  };
}

const KEYED = new Set<SearchEngine>(['exa', 'langsearch', 'tavily', 'firecrawl', 'serper', 'you']);

/** Default cascade. `SEARCH_ORDER` may move names; unknown tokens are ignored; anything left out is appended in this order. */
// Router: Serper → You.com (keyed) → LangSearch → You.com keyless → Wikipedia; Exa last resort.
// Future adapters: BRAVE_API_KEY, TINYFISH_API_KEY, PARALLEL_API_KEY.
const DEFAULT_ORDER: readonly SearchEngine[] = ['serper', 'you', 'langsearch', 'you-keyless', 'wikipedia', 'tavily', 'firecrawl', 'exa', 'backup'];

export function searchOrder(env: Env): SearchEngine[] {
  const known = new Set<string>(SEARCH_ENGINES);
  const listed: SearchEngine[] = [];
  const seen = new Set<string>();
  for (const raw of (env.SEARCH_ORDER ?? '').split(',')) {
    const name = raw.trim();
    if (!name || !known.has(name) || seen.has(name)) continue;
    seen.add(name);
    listed.push(name as SearchEngine);
  }
  for (const name of DEFAULT_ORDER) {
    if (!seen.has(name)) listed.push(name);
  }
  return listed;
}

type Settled = { ok: true; value: { hits: WebHit[]; images: ImageResult[] } } | { ok: false; error: unknown };
const settled = (task: Promise<{ hits: WebHit[]; images: ImageResult[] }>): Promise<Settled> =>
  task.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

interface WikiOutcome {
  hits: WebHit[];
  error?: string;
  ms: number;
}

/**
 * Serper, You.com (keyed), LangSearch, You.com keyless, Wikipedia, then Tavily/Firecrawl/Exa,
 * unless SEARCH_ORDER says otherwise. DuckDuckGo lite runs only when ZO_DDG_BACKUP=1, after Wikipedia.
 * Keyed steps are skipped when their key is empty. The next engine runs only after
 * a credit, quota, auth, timeout, upstream, empty, or daily-cap failure. Dead
 * engines, and engines on the shared skip list, are skipped without a call. A
 * keyed error raises the call cap by two so the chain can still reach the next
 * live provider. A keyed success also takes the planner rewrites on that same
 * engine; each of those counts against the provider's daily cap. Wikipedia runs
 * in parallel only when fewer than two rewrites are queued, so the ask stays
 * inside callCap(ledger). Wikipedia is returned separately so it ranks after the
 * engine. At most callCap(ledger) calls. A refused daily slot is not a call.
 */
const TRIP_REASONS = new Set(['payment', 'quota', 'unavailable', 'credit']);

export async function cascadeWeb(q: Query, env: Env, ledger: CallLedger, waitUntil?: (promise: Promise<unknown>) => void, bucket: CapBucket = 'prod'): Promise<CascadeResult> {
  const skips = await loadSkips(env);
  const forced = (name: string) => (ledger.force === 'serper-off' && name === 'serper') || (ledger.force === 'degraded' && KEYED.has(name as SearchEngine));
  const blocked = (name: string) => forced(name) || engineDead(name) || (skips[name] ?? 0) > Date.now();
  const noteFailure = async (name: SearchEngine, failure: { dead: boolean; reason: string }, grantBonus: boolean) => {
    if (failure.dead) rememberDead(name);
    if (TRIP_REASONS.has(failure.reason)) await tripSkip(env, name, failure.reason, waitUntil);
    if (grantBonus && KEYED.has(name) && failure.reason !== 'empty') ledger.bonus = Math.max(ledger.bonus ?? 0, 2);
  };
  const statuses: EngineStatus[] = [];
  const share = (name: string) => (name === 'serper' && bucket === 'prod' ? ledger.serperShare ?? 1 : 1);
  const catalog = new Map<SearchEngine, { name: SearchEngine; enabled: boolean; run: (text: string, fresh?: Freshness) => Promise<{ hits: WebHit[]; images: ImageResult[] }> }>([
    ['exa', { name: 'exa', enabled: hasKey(env, 'EXA_API_KEY'), run: (text, fresh = q.freshness) => exaSearch({ ...q, q: text, freshness: fresh }, env) }],
    ['langsearch', { name: 'langsearch', enabled: hasKey(env, 'LANGSEARCH_API_KEY'), run: (text, fresh = q.freshness) => langSearch({ ...q, q: text, freshness: fresh }, env) }],
    ['tavily', { name: 'tavily', enabled: hasKey(env, 'TAVILY_API_KEY'), run: (text, fresh = q.freshness) => tavilySearch({ ...q, q: text, freshness: fresh }, env) }],
    ['firecrawl', { name: 'firecrawl', enabled: hasKey(env, 'FIRECRAWL_API_KEY'), run: (text, fresh = q.freshness) => firecrawlSearch({ ...q, q: text, freshness: fresh }, env) }],
    ['serper', { name: 'serper', enabled: hasKey(env, 'SERPER_API_KEY'), run: (text, fresh = q.freshness) => serperSearch({ ...q, q: text, freshness: fresh }, env) }],
    ['you', { name: 'you', enabled: youKeyPresent(env), run: (text) => youKeyedSearch(text, env) }],
    ['you-keyless', { name: 'you-keyless', enabled: true, run: (text) => youKeylessSearch(text, env) }],
    ['wikipedia', { name: 'wikipedia', enabled: true, run: async () => ({ hits: await fetchWikiSearch(q.q), images: [] }) }],
    ['backup', { name: 'backup', enabled: ddgBackupOn(env), run: async () => ({ hits: await fetchBackup(q.q, q.freshness), images: [] }) }],
  ]);
  const steps = searchOrder(env).map((name) => catalog.get(name)!);

  let wikiTask: Promise<WikiOutcome> | undefined;
  let wikiReported = false;

  const startWiki = () => {
    if (wikiTask || blocked('wikipedia') || searchCalls(ledger) >= callCap(ledger)) return;
    ledger.search.wikipedia += 1;
    const started = Date.now();
    wikiTask = fetchWikiSearch(q.q).then(
      (hits) => ({ hits, ms: Date.now() - started }),
      (err: unknown) => {
        const failure = failureOf(err);
        if (failure.dead) rememberDead('wikipedia');
        return { hits: [] as WebHit[], error: failure.reason, ms: Date.now() - started };
      },
    );
  };

  const takeWiki = async (): Promise<WebHit[]> => {
    if (!wikiTask) return [];
    const wiki = await wikiTask;
    const hits = wiki.hits.filter((h) => h.url && h.title);
    if (!wikiReported) {
      wikiReported = true;
      if (!hits.length) ledger.fellThrough.push(`wikipedia:${wiki.error ?? 'empty'}`);
      statuses.push({ name: 'wikipedia', ok: hits.length > 0, count: hits.length, ms: wiki.ms, error: hits.length ? undefined : wiki.error ?? 'empty' });
    }
    return hits;
  };

  const none = (): CascadeResult => ({ engine: 'none', hits: [], more: [], wikiHits: [], images: [], statuses });
  // SPD2: with `later`, the literal call starts before the rewrites are known; they join as soon as they arrive.
  const extrasReady: Promise<{ extras: string[]; fresh: Freshness }> = q.later
    ? q.later.then((l) => ({ extras: plannedExtras({ ...q, more: l.more }), fresh: l.freshness }), () => ({ extras: [], fresh: q.freshness }))
    : Promise.resolve({ extras: plannedExtras(q), fresh: q.freshness });
  let extras: string[] = q.later ? [] : plannedExtras(q);
  const cascadeStarted = Date.now();
  const literalGood = (r: Settled) => r.ok && gateResults(q.q, r.value.hits.filter((h) => h.url && h.title)).kept.length >= LITERAL_OK;
  /**
   * Rewrites for a step whose literal call is already running. A thin or failed literal search waits for
   * them (they are the recall path for niche or badly typed asks); a good one waits only briefly.
   */
  const extrasFor = async (early: Promise<Settled>): Promise<{ extras: string[]; fresh?: Freshness }> => {
    if (q.waitExtras) return extrasReady;
    const first = await Promise.race([extrasReady.then((v) => ({ v })), early.then((r) => ({ r }))]);
    if ('v' in first) return first.v;
    if (!first.r.ok) return NO_EXTRAS;
    if (!literalGood(first.r)) return extrasReady;
    // Searches known before the intent read ("Edward Chu" for "who is Ed Chu", ticker news) never wait on it.
    const upfront = q.more?.length ? { extras: plannedExtras(q), fresh: q.freshness } : NO_EXTRAS;
    const left = EXTRAS_WAIT_MS - (Date.now() - cascadeStarted);
    return left > 0 ? Promise.race([extrasReady, sleep(left).then(() => upfront)]) : upfront;
  };

  // Past Serper, a fallback engine answers almost anything with 20 rows; when few of them are on topic
  // the next engine is asked too (one extra call) and the stronger list leads.
  let held: { result: CascadeResult; strong: number } | undefined;
  // The second opinion is one engine, never a walk down to the paid ones.
  let heldTried = false;
  const strongOf = (r: CascadeResult) => strongCount(q.q, [...r.hits, ...r.more.flatMap((m) => m.hits)]);
  const finish = (result: CascadeResult, name: string): CascadeResult | undefined => {
    const strong = strongOf(result);
    if (held) {
      const [lead, next] = strong > held.strong ? [result, held.result] : [held.result, result];
      ledger.fellThrough.push(`${name}:second-opinion`);
      return {
        engine: lead.engine,
        hits: lead.hits,
        more: [...lead.more, { query: q.q, hits: next.hits }, ...next.more],
        wikiHits: lead.wikiHits.length ? lead.wikiHits : next.wikiHits,
        images: [...lead.images, ...next.images],
        statuses,
      };
    }
    const rows = result.hits.length + result.more.reduce((n, m) => n + m.hits.length, 0);
    if (name === 'serper' || name === 'wikipedia' || strong >= SECOND_OPINION_MIN || rows < NOISY_ROWS) return result;
    held = { result, strong };
    ledger.bonus = (ledger.bonus ?? 0) + 1;
    return undefined;
  };

  for (const step of steps) {
    if (!step.enabled) continue;
    // The second opinion only asks free engines; keyed ones spend free-plan credits.
    if (held && (heldTried || KEYED.has(step.name))) break;
    if (step.name === 'wikipedia' && wikiTask) {
      if (held) heldTried = true;
      const hits = await takeWiki();
      if (hits.length) return held ? finish({ engine: 'wikipedia', hits, more: [], wikiHits: [], images: [], statuses }, 'wikipedia')! : { engine: 'wikipedia', hits, more: [], wikiHits: [], images: [], statuses };
      if (held) break;
      continue;
    }
    if (blocked(step.name)) {
      ledger.fellThrough.push(`${step.name}:skipped`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: 0, error: 'skipped' });
      continue;
    }
    if (searchCalls(ledger) >= callCap(ledger)) {
      ledger.fellThrough.push(`${step.name}:cap`);
      break;
    }
    if (!(await takeSlot(env, step.name, bucket, undefined, share(step.name)))) {
      ledger.fellThrough.push(`${step.name}:cap-daily`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: 0, error: 'cap-daily' });
      continue;
    }
    ledger.search[step.name] += 1;
    if (held) heldTried = true;
    const started = Date.now();
    const early = q.later && KEYED.has(step.name) ? settled(step.run(q.q)) : undefined;
    const ready = early ? await extrasFor(early) : KEYED.has(step.name) ? await extrasReady : NO_EXTRAS;
    extras = ready.extras;
    // Two planner rewrites plus this call fill the cap. Wikipedia stays off so both rewrites still run.
    if (KEYED.has(step.name) && extras.length < 2) startWiki();
    // SPD1 (t457): every route runs its rewrites alongside the literal search, each counted and capped like it.
    // Quick asks used to wait for the literal call before starting their one rewrite (~1.5 s serial).
    let parallel: { text: string; task: Promise<Settled>; at: number }[] | undefined;
    if (KEYED.has(step.name) && extras.length) {
      parallel = [];
      for (const text of extras) {
        if (searchCalls(ledger) >= callCap(ledger)) break;
        if (!(await takeSlot(env, step.name, bucket, undefined, share(step.name)))) break;
        ledger.search[step.name] += 1;
        parallel.push({ text, task: settled(step.run(text, ready.fresh)), at: Date.now() });
      }
    }
    try {
      const lit: Settled = early ? await early : parallel?.length ? await settled(step.run(q.q)) : { ok: true, value: await step.run(q.q) };
      const out = lit.ok ? lit.value : { hits: [], images: [] };
      let hits = out.hits.filter((h) => h.url && h.title);
      let images = out.images;
      if (!hits.length && parallel?.length) {
        // The rewrites already spent this ask's calls, so an empty literal search answers from them.
        const rescued: { query: string; hits: WebHit[]; images: ImageResult[] }[] = [];
        for (const p of parallel) {
          const done = await p.task;
          const extra = done.ok ? done.value.hits.filter((h) => h.url && h.title) : [];
          if (extra.length) rescued.push({ query: p.text, hits: extra, images: done.ok ? done.value.images : [] });
          else ledger.fellThrough.push(`${step.name}:also-${done.ok ? 'empty' : failureOf(done.error).reason}`);
        }
        if (rescued.length) {
          ledger.fellThrough.push(`${step.name}:empty-literal-rescued`);
          statuses.push({ name: step.name, ok: true, count: rescued.reduce((n, r) => n + r.hits.length, 0), ms: Date.now() - started });
          const [lead, ...rest] = rescued;
          const wikiHits = await takeWiki();
          const done = finish({ engine: step.name, hits: lead.hits, more: rest.map(({ query, hits }) => ({ query, hits })), wikiHits, images: rescued.flatMap((r) => r.images), statuses }, step.name);
          if (done) return done;
          continue;
        }
      }
      if (!lit.ok) throw lit.error;
      if (!hits.length) {
        ledger.fellThrough.push(`${step.name}:empty`);
        statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: 'empty' });
        continue;
      }
      const more: { query: string; hits: WebHit[] }[] = [];
      /** Records one rewrite's outcome; true when the engine is dead and later rewrites should stop. */
      const settle = async (text: string, task: Promise<Settled>, againAt: number): Promise<boolean> => {
        const done = await task;
        if (done.ok) {
          const extra = done.value.hits.filter((h) => h.url && h.title);
          if (!extra.length) ledger.fellThrough.push(`${step.name}:also-empty`);
          else {
            more.push({ query: text, hits: extra });
            images = [...images, ...done.value.images];
          }
          return false;
        }
        const failure = failureOf(done.error);
        await noteFailure(step.name, failure, false);
        ledger.fellThrough.push(`${step.name}:also-${failure.reason}`);
        statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - againAt, error: failure.reason });
        return failure.dead;
      };
      if (parallel) {
        // A good literal search never waits out a slow rewrite: what has not landed by the cut is dropped.
        const cut = !q.waitExtras && parallel.length && literalGood({ ok: true, value: out }) ? sleep(EXTRA_RESULTS_WAIT_MS).then(() => 'late' as const) : undefined;
        for (const p of parallel) {
          const done = cut ? await Promise.race([p.task, cut]) : await p.task;
          if (done === 'late') {
            ledger.fellThrough.push(`${step.name}:also-late`);
            continue;
          }
          await settle(p.text, Promise.resolve(done), p.at);
        }
      } else if (KEYED.has(step.name)) {
        for (const text of extras) {
          if (searchCalls(ledger) >= callCap(ledger) || engineDead(step.name)) break;
          if (!(await takeSlot(env, step.name, bucket, undefined, share(step.name)))) break;
          ledger.search[step.name] += 1;
          if (await settle(text, settled(step.run(text)), Date.now())) break;
        }
      }
      statuses.push({ name: step.name, ok: true, count: hits.length + more.reduce((n, list) => n + list.hits.length, 0), ms: Date.now() - started });
      const wikiHits = KEYED.has(step.name) ? await takeWiki() : [];
      const done = finish({ engine: step.name, hits, more, wikiHits, images, statuses }, step.name);
      if (done) return done;
    } catch (err) {
      const failure = failureOf(err);
      await noteFailure(step.name, failure, true);
      ledger.fellThrough.push(`${step.name}:${failure.reason}`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: failure.reason });
      if (!failure.fall) break;
    }
  }
  if (held) return { ...held.result, statuses };
  if (wikiTask && !wikiReported) {
    const hits = await takeWiki();
    if (hits.length) return { engine: 'wikipedia', hits, more: [], wikiHits: [], images: [], statuses };
  }
  return none();
}
