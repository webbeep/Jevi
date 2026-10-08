import { cleanMarkdown } from '../shared/text';
import type { EngineStatus, Freshness, ImageResult } from '../shared/types';
import { ddgBackupOn, fetchBackup } from './backup';
import { SEARCH_ENGINES, callCap, type CallLedger, type SearchEngine, engineDead, failureOf, rememberDead, searchCalls } from './budget';
import { loadSkips, tripSkip } from './engineSkip';
import { takeSlot, type CapBucket } from './providerCap';
import { HttpStatusError, type Env, clip, domainOf, fetchJson } from './util';
import { fetchWikiSearch } from './wikiSearch';

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
  freshness: Freshness;
  count: number;
}

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

async function serperSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{ organic?: { title: string; link: string; snippet?: string; date?: string; imageUrl?: string }[] }>(
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
      image: r.imageUrl,
    })),
    images: [],
  };
}

const KEYED = new Set<SearchEngine>(['exa', 'langsearch', 'tavily', 'firecrawl', 'serper']);

/** Default cascade. `SEARCH_ORDER` may move names; unknown tokens are ignored; anything left out is appended in this order. */
const DEFAULT_ORDER: readonly SearchEngine[] = ['serper', 'langsearch', 'exa', 'tavily', 'firecrawl', 'wikipedia', 'backup'];

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

interface WikiOutcome {
  hits: WebHit[];
  error?: string;
  ms: number;
}

/**
 * Serper, LangSearch, Exa, Tavily, Firecrawl, then Wikipedia, unless SEARCH_ORDER
 * says otherwise. DuckDuckGo lite runs only when ZO_DDG_BACKUP=1, after Wikipedia.
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
  const blocked = (name: string) => engineDead(name) || (skips[name] ?? 0) > Date.now();
  const noteFailure = async (name: SearchEngine, failure: { dead: boolean; reason: string }, grantBonus: boolean) => {
    if (failure.dead) rememberDead(name);
    if (TRIP_REASONS.has(failure.reason)) await tripSkip(env, name, failure.reason, waitUntil);
    if (grantBonus && KEYED.has(name) && failure.reason !== 'empty') ledger.bonus = Math.max(ledger.bonus ?? 0, 2);
  };
  const statuses: EngineStatus[] = [];
  const catalog = new Map<SearchEngine, { name: SearchEngine; enabled: boolean; run: (text: string) => Promise<{ hits: WebHit[]; images: ImageResult[] }> }>([
    ['exa', { name: 'exa', enabled: hasKey(env, 'EXA_API_KEY'), run: (text) => exaSearch({ ...q, q: text }, env) }],
    ['langsearch', { name: 'langsearch', enabled: hasKey(env, 'LANGSEARCH_API_KEY'), run: (text) => langSearch({ ...q, q: text }, env) }],
    ['tavily', { name: 'tavily', enabled: hasKey(env, 'TAVILY_API_KEY'), run: (text) => tavilySearch({ ...q, q: text }, env) }],
    ['firecrawl', { name: 'firecrawl', enabled: hasKey(env, 'FIRECRAWL_API_KEY'), run: (text) => firecrawlSearch({ ...q, q: text }, env) }],
    ['serper', { name: 'serper', enabled: hasKey(env, 'SERPER_API_KEY'), run: (text) => serperSearch({ ...q, q: text }, env) }],
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
  const extras = plannedExtras(q);

  for (const step of steps) {
    if (!step.enabled) continue;
    if (step.name === 'wikipedia' && wikiTask) {
      const hits = await takeWiki();
      if (hits.length) return { engine: 'wikipedia', hits, more: [], wikiHits: [], images: [], statuses };
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
    if (!(await takeSlot(env, step.name, bucket))) {
      ledger.fellThrough.push(`${step.name}:cap-daily`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: 0, error: 'cap-daily' });
      continue;
    }
    ledger.search[step.name] += 1;
    const started = Date.now();
    // Two planner rewrites plus this call fill the cap. Wikipedia stays off so both rewrites still run.
    if (KEYED.has(step.name) && extras.length < 2) startWiki();
    try {
      const out = await step.run(q.q);
      let hits = out.hits.filter((h) => h.url && h.title);
      let images = out.images;
      if (!hits.length) {
        ledger.fellThrough.push(`${step.name}:empty`);
        statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: 'empty' });
        continue;
      }
      const more: { query: string; hits: WebHit[] }[] = [];
      if (KEYED.has(step.name)) {
        for (const text of extras) {
          if (searchCalls(ledger) >= callCap(ledger) || engineDead(step.name)) break;
          if (!(await takeSlot(env, step.name, bucket))) break;
          ledger.search[step.name] += 1;
          const againAt = Date.now();
          try {
            const again = await step.run(text);
            const extra = again.hits.filter((h) => h.url && h.title);
            if (!extra.length) ledger.fellThrough.push(`${step.name}:also-empty`);
            else {
              more.push({ query: text, hits: extra });
              images = [...images, ...again.images];
            }
          } catch (err) {
            const failure = failureOf(err);
            await noteFailure(step.name, failure, false);
            ledger.fellThrough.push(`${step.name}:also-${failure.reason}`);
            statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - againAt, error: failure.reason });
            if (failure.dead) break;
          }
        }
      }
      statuses.push({ name: step.name, ok: true, count: hits.length + more.reduce((n, list) => n + list.hits.length, 0), ms: Date.now() - started });
      const wikiHits = KEYED.has(step.name) ? await takeWiki() : [];
      return { engine: step.name, hits, more, wikiHits, images, statuses };
    } catch (err) {
      const failure = failureOf(err);
      await noteFailure(step.name, failure, true);
      ledger.fellThrough.push(`${step.name}:${failure.reason}`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: failure.reason });
      if (!failure.fall) break;
    }
  }
  if (wikiTask && !wikiReported) {
    const hits = await takeWiki();
    if (hits.length) return { engine: 'wikipedia', hits, more: [], wikiHits: [], images: [], statuses };
  }
  return none();
}
