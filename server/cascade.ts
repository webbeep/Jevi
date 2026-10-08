import { cleanMarkdown } from '../shared/text';
import type { EngineStatus, Freshness, ImageResult } from '../shared/types';
import { ddgBackupOn, fetchBackup } from './backup';
import { SEARCH_CALL_CAP, type CallLedger, type SearchEngine, engineDead, failureOf, rememberDead, searchCalls } from './budget';
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
    code?: number;
    data?: { webPages?: { value?: { name?: string; url: string; snippet?: string; datePublished?: string | null }[] } };
  }>(
    'https://api.langsearch.com/v1/web-search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LANGSEARCH_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q.q,
        count: 10,
        freshness: q.freshness === 'any' ? 'noLimit' : LANG_FRESH[q.freshness],
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  if (typeof data.code === 'number' && data.code !== 200) throw new HttpStatusError(data.code);
  return {
    hits: (data.data?.webPages?.value ?? []).map((r) => ({
      title: r.name || domainOf(r.url),
      url: r.url,
      snippet: clip(r.snippet ?? '', 320),
      date: r.datePublished ?? undefined,
    })),
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
      date: r.date,
      image: r.imageUrl,
    })),
    images: [],
  };
}

const KEYED = new Set<SearchEngine>(['exa', 'langsearch', 'tavily', 'firecrawl', 'serper']);

interface WikiOutcome {
  hits: WebHit[];
  error?: string;
  ms: number;
}

/**
 * Exa, LangSearch, Tavily, Firecrawl, Serper, then Wikipedia. DuckDuckGo lite
 * runs only when ZO_DDG_BACKUP=1, after Wikipedia. Keyed steps are skipped when
 * their key is empty. The next engine runs only after a credit, quota, auth,
 * timeout, upstream, or empty failure. Dead engines are skipped without a call.
 * A keyed success also takes the planner rewrites on that same engine. Wikipedia
 * runs in parallel only when fewer than two rewrites are queued, so the ask
 * stays inside SEARCH_CALL_CAP. Wikipedia is returned separately so it ranks
 * after the engine. At most SEARCH_CALL_CAP calls.
 */
export async function cascadeWeb(q: Query, env: Env, ledger: CallLedger): Promise<CascadeResult> {
  const statuses: EngineStatus[] = [];
  const steps: { name: SearchEngine; enabled: boolean; run: (text: string) => Promise<{ hits: WebHit[]; images: ImageResult[] }> }[] = [
    { name: 'exa', enabled: hasKey(env, 'EXA_API_KEY'), run: (text) => exaSearch({ ...q, q: text }, env) },
    { name: 'langsearch', enabled: hasKey(env, 'LANGSEARCH_API_KEY'), run: (text) => langSearch({ ...q, q: text }, env) },
    { name: 'tavily', enabled: hasKey(env, 'TAVILY_API_KEY'), run: (text) => tavilySearch({ ...q, q: text }, env) },
    { name: 'firecrawl', enabled: hasKey(env, 'FIRECRAWL_API_KEY'), run: (text) => firecrawlSearch({ ...q, q: text }, env) },
    { name: 'serper', enabled: hasKey(env, 'SERPER_API_KEY'), run: (text) => serperSearch({ ...q, q: text }, env) },
    { name: 'wikipedia', enabled: true, run: async () => ({ hits: await fetchWikiSearch(q.q), images: [] }) },
    { name: 'backup', enabled: ddgBackupOn(env), run: async () => ({ hits: await fetchBackup(q.q, q.freshness), images: [] }) },
  ];

  let wikiTask: Promise<WikiOutcome> | undefined;
  let wikiReported = false;

  const startWiki = () => {
    if (wikiTask || engineDead('wikipedia') || searchCalls(ledger) >= SEARCH_CALL_CAP) return;
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
    if (engineDead(step.name)) {
      ledger.fellThrough.push(`${step.name}:skipped`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: 0, error: 'skipped' });
      continue;
    }
    if (searchCalls(ledger) >= SEARCH_CALL_CAP) {
      ledger.fellThrough.push(`${step.name}:cap`);
      break;
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
          if (searchCalls(ledger) >= SEARCH_CALL_CAP || engineDead(step.name)) break;
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
            if (failure.dead) rememberDead(step.name);
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
      if (failure.dead) rememberDead(step.name);
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
