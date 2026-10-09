import type {
  Discussion,
  Freshness,
  ImageResult,
  Knowledge,
  SearchResponse,
  SearchResult,
} from '../shared/types';
import { knowledgeMatches } from '../shared/relevance';
import type { AskScope } from './budget';
import { newLedger } from './budget';
import { cacheDb, packSearch, readSearchCache, searchCacheKey, writeSearchCache } from './cache';
import { cascadeWeb } from './cascade';
import { searchDegraded } from './degraded';
import { diversify } from './diversify';
import { gateResults } from './relevanceGate';
import { commons, openverse, permitted } from './images';
import { maybeBluesky, socialSources } from './social';
import { UA, domainOf, fetchJson, hedge, type Env } from './util';

interface Query {
  q: string;
  /** Planner rewrites. Each is one extra call on the engine that answered, still inside the cap. */
  more?: string[];
  /** SPD2: rewrites (and their freshness) that arrive while the literal search is already running. */
  later?: Promise<{ more: string[]; freshness: Freshness }>;
  freshness: Freshness;
  count: number;
  /**
   * Web results only, from the keyed engines (DuckDuckGo when there are none): for searches that run
   * beside a full one. Workers allow 50 subrequests per request, and a full search alone uses about 25.
   */
  lite?: boolean;
  /** Always wait for `later` rewrites (deep asks), even when the literal search already answered. */
  waitExtras?: boolean;
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  date?: string;
  content?: string;
}

export function keyedEngines(env: Env): string[] {
  const keys: [keyof Env, string][] = [
    ['BRAVE_API_KEY', 'brave'],
    ['TAVILY_API_KEY', 'tavily'],
    ['EXA_API_KEY', 'exa'],
    ['PERPLEXITY_API_KEY', 'perplexity'],
    ['SERPER_API_KEY', 'serper'],
    ['JINA_API_KEY', 'jina'],
    ['LANGSEARCH_API_KEY', 'langsearch'],
    ['FIRECRAWL_API_KEY', 'firecrawl'],
    ['YOU_API_KEY', 'you'],
  ];
  return keys.filter(([k]) => !!env[k]).map(([, name]) => name);
}


export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => u.searchParams.delete(k));
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

const ENGINE_WEIGHT: Record<string, number> = { brave: 1.2, serper: 1.2, exa: 1.2, perplexity: 1.2, tavily: 1.1, jina: 1.1, you: 1.15, 'you-keyless': 1.05, marginalia: 0.5, wikipedia: 0.8 };

/** Reciprocal rank fusion across engines, so results found by several engines rise. */
const QUERY_STOP = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'when', 'who', 'are', 'is', 'to', 'of', 'in', 'on', 'a', 'an', 'vs', 'best', 'my', 'do', 'does', 'can', 'i']);
/** "dropping" → "drop", "injuries" → "injur", "watched" → "watch": matched as a prefix of the page text. */
const stem = (w: string) => {
  const s = w.length >= 6 ? w.replace(/(ing|ed)$/, '') : w;
  return (s !== w && /([b-df-hj-np-tv-z])\1$/.test(s) ? s.slice(0, -1) : s).replace(/(ies|es|s)$/, '');
};

/**
 * Share of the query's significant words a result mentions in its title, snippet or URL (0-1).
 * `typed`: the person's own words, lifted to 0.5 once a third of them (at least two) are there, since a
 * long, chatty ask ("lebron preseason debut what to expect and how to watch") is rarely repeated whole.
 * Planner rewrites are already precise and keep the plain share.
 */
export function coverage(query: string, hit: Pick<Hit, 'title' | 'snippet' | 'url'>, typed = false): number {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !QUERY_STOP.has(w)).map(stem))];
  if (!words.length) return 1;
  const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
  const found = words.filter((w) => text.includes(w)).length;
  const share = found / words.length;
  return typed && found >= Math.max(2, Math.ceil(words.length / 3)) ? Math.max(0.5, share) : share;
}

/**
 * Weighted reciprocal-rank fusion, scaled by how much of the query each result
 * covers. Results that only one engine returned and that miss most of the
 * query ("Apple Store" for "apple pie recipe") are dropped.
 */
/** Rank-by-rank across lists that were each already scored against their own query. */
function interleaveResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  const n = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < n; i++) {
    for (const list of lists) {
      const hit = list[i];
      if (!hit?.url || seen.has(normalizeUrl(hit.url))) continue;
      seen.add(normalizeUrl(hit.url));
      out.push(hit);
    }
  }
  return out;
}

function fuse(outputs: { engine: string; hits: Hit[] }[], count: number, query: string, typed = false): SearchResult[] {
  const merged = new Map<string, SearchResult & { score: number }>();
  for (const { engine, hits } of outputs) {
    hits.forEach((hit, rank) => {
      if (!hit.url || !hit.title) return;
      const key = normalizeUrl(hit.url);
      const existing = merged.get(key);
      const score = (ENGINE_WEIGHT[engine] ?? 1) / (rank + 3);
      if (existing) {
        existing.score += score;
        existing.engines.push(engine);
        if (hit.snippet.length > existing.snippet.length) existing.snippet = hit.snippet;
        existing.image ??= hit.image;
        existing.date ??= hit.date;
        existing.content ??= hit.content;
      } else {
        merged.set(key, { ...hit, domain: domainOf(hit.url), engines: [engine], score });
      }
    });
  }
  return [...merged.values()]
    .map((r) => ({ r, cover: coverage(query, r, typed) }))
    .filter(({ r, cover }) => cover >= 0.5 || r.engines.length > 1)
    .map(({ r, cover }) => ({ ...r, score: r.score * (0.3 + cover) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ score: _score, ...r }) => r);
}

async function instantAnswer(q: string): Promise<Knowledge | undefined> {
  const data = await fetchJson<{ Heading?: string; AbstractText?: string; AbstractURL?: string; Image?: string; Entity?: string }>(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': UA } },
    4000,
  );
  if (!data.AbstractText || !data.AbstractURL) return undefined;
  return {
    title: data.Heading ?? q,
    extract: data.AbstractText,
    url: data.AbstractURL,
    image: data.Image ? (data.Image.startsWith('http') ? data.Image : `https://duckduckgo.com${data.Image}`) : undefined,
    description: data.Entity,
  };
}

async function wikiSummary(title: string): Promise<Knowledge | undefined> {
  const data = await fetchJson<{
    type?: string;
    title: string;
    extract?: string;
    description?: string;
    thumbnail?: { source: string };
    content_urls?: { desktop?: { page?: string } };
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: { 'User-Agent': UA } }, 4000);
  if (!data.extract || data.type === 'disambiguation') return undefined;
  return {
    title: data.title,
    extract: data.extract,
    url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    image: data.thumbnail?.source,
    description: data.description,
  };
}

/** Topic imagery from open-licensed libraries only (commercial use allowed). */
function images(q: string): Promise<ImageResult[]> {
  const nonEmpty = (task: () => Promise<ImageResult[]>) => async () => {
    const out = await task();
    if (!out.length) throw new Error('no images');
    return out;
  };
  return hedge([nonEmpty(() => openverse(q, 12)), nonEmpty(() => commons(q, 12))], 600);
}

async function discussions(q: string): Promise<Discussion[]> {
  const data = await fetchJson<{
    hits?: { title?: string; url?: string; objectID: string; points?: number; num_comments?: number; created_at: string }[];
  }>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`, {}, 4000);
  return (data.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      title: h.title!,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      date: h.created_at,
    }));
}

function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

/** Supplementary lookups may finish at most this long after the web results. */
const EXTRAS_GRACE_MS = 300;

export interface LateExtras {
  /** Page content from engines that finished after the response, keyed by normalized URL. */
  content: Map<string, string>;
  /** Images from engines that finished after the response. */
  images: ImageResult[];
}

export interface SearchWithLate {
  response: SearchResponse;
  /** Page content from engines that finished after the response was ready, keyed by normalized URL. */
  late: Promise<LateExtras>;
}

export async function search(q: Query, env: Env, scope?: AskScope): Promise<SearchResponse> {
  return (await searchWithLate(q, env, scope)).response;
}

async function wikiKnowledge(q: string): Promise<Knowledge | undefined> {
  const data = await fetchJson<{ query?: { search?: { title: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1&origin=*`,
    { headers: { 'User-Agent': UA } },
    3000,
  );
  const title = data.query?.search?.[0]?.title;
  return title ? wikiSummary(title) : undefined;
}

const emptyLate = (): LateExtras => ({ content: new Map(), images: [] });

export async function searchWithLate(q: Query, env: Env, scope?: AskScope): Promise<SearchWithLate> {
  const ask: AskScope = scope ?? { ledger: newLedger(), bypass: false };
  const key = searchCacheKey(q.q, q.freshness, q.count);
  const db = cacheDb(env);

  if (ask.bypass) {
    ask.ledger.cache = 'bypass';
  } else if (ask.refresh) {
    ask.ledger.cache = db ? 'miss' : 'off';
  } else {
    const cached = await readSearchCache(db, key);
    // T424: a degraded cached search (0 sources / Wikipedia-only / provider errors) is a miss.
    if (cached.kind === 'hit' && !searchDegraded(cached.response)) {
      ask.ledger.cache = 'hit';
      const hit = gateResults(q.q, cached.response.results);
      ask.ledger.relevanceDropped = (ask.ledger.relevanceDropped ?? 0) + hit.dropped;
      const response = hit.dropped ? { ...cached.response, results: hit.kept } : cached.response;
      return { response: { ...response, query: q.q, freshness: q.freshness }, late: Promise.resolve(emptyLate()) };
    }
    ask.ledger.cache = cached.kind === 'off' ? 'off' : 'miss';
  }

  const webPromise = cascadeWeb(q, env, ask.ledger, ask.waitUntil, ask.eval ? 'eval' : 'prod');
  // ZO_SOCIAL=1 only: one keyless Bluesky call beside the cascade, not counted as a web engine. No-op on error.
  const socialTask = maybeBluesky(q, env);
  const graceOver = webPromise.then(() => new Promise<void>((r) => setTimeout(r, EXTRAS_GRACE_MS)));
  const bounded = <T,>(p: Promise<T>, fallback: T) => Promise.race([settle(p, fallback), graceOver.then(() => fallback)]);
  const instantP = q.lite ? Promise.resolve(undefined) : instantAnswer(q.q);
  const wikiP = q.lite ? Promise.resolve(undefined) : wikiKnowledge(q.q);
  const imgP = q.lite ? Promise.resolve([] as ImageResult[]) : images(q.q);
  const hnP = q.lite ? Promise.resolve([] as Discussion[]) : discussions(q.q);
  const [web, instant, wiki, imgs, hn, social] = await Promise.all([
    webPromise,
    q.lite ? undefined : bounded(instantP, undefined),
    q.lite ? undefined : bounded(wikiP, undefined),
    q.lite ? [] : bounded(imgP, [] as ImageResult[]),
    q.lite ? [] : bounded(hnP, [] as Discussion[]),
    socialTask,
  ]);
  if (web.engine !== 'none') ask.served = web.engine;

  // Each query is scored against its own words, then interleaved with the literal question first.
  const fused = [
    fuse([{ engine: web.engine, hits: web.hits }], q.count, q.q, true),
    ...web.more.map((list) => fuse([{ engine: web.engine, hits: list.hits }], q.count, list.query)),
  ];
  const primary = interleaveResults(fused);
  const taken = new Set(primary.map((r) => normalizeUrl(r.url)));
  const wikiExtra = fuse([{ engine: 'wikipedia', hits: web.wikiHits }], q.count, q.q).filter((r) => !taken.has(normalizeUrl(r.url)));
  const web12 = diversify(q.q, [...primary, ...wikiExtra]);
  const webUrls = new Set(web12.map((r) => normalizeUrl(r.url)));
  const extra = socialSources(social.posts).filter((r) => !webUrls.has(normalizeUrl(r.url))).slice(0, 5);
  // Lead with posts so a time-sensitive card can cite them inside the same result cap.
  // Relevance runs after diversify and before the cap, so a junk hit cannot take a slot the model will read.
  const pooled = gateResults(q.q, [...extra, ...web12]);
  ask.ledger.relevanceDropped = (ask.ledger.relevanceDropped ?? 0) + pooled.dropped;
  const results = pooled.kept.slice(0, q.count);
  const knowledge = (instant && knowledgeMatches(q.q, instant.title, instant.description) ? instant : undefined)
    ?? (wiki && knowledgeMatches(q.q, wiki.title, wiki.description) ? wiki : undefined);
  const content = new Map<string, string>();
  web.hits.forEach((h) => h.content && content.set(normalizeUrl(h.url), h.content));
  const late = Promise.resolve({ content, images: [] as ImageResult[] });

  const seen = new Set<string>();
  const allImages = permitted([
    ...(knowledge?.image ? [{ url: knowledge.url, thumb: knowledge.image, title: knowledge.title, source: domainOf(knowledge.url), license: 'source' as const, credit: 'Wikipedia' }] : []),
    ...web.images,
    ...results.filter((r) => r.image).map((r) => ({ url: r.url, thumb: r.image!, title: r.title, source: r.domain, license: 'source' as const, credit: r.domain })),
    ...imgs,
  ], env).filter((img) => img.thumb && !seen.has(img.thumb) && seen.add(img.thumb));

  const response: SearchResponse = {
    query: q.q,
    freshness: q.freshness,
    results,
    images: allImages.slice(0, 16),
    knowledge,
    discussions: hn,
    engines: social.status ? [...web.statuses, social.status] : web.statuses,
  };

  const degraded = searchDegraded(response);
  if (degraded) Object.assign(response, { degraded: true, degradedReason: degraded });
  // T424: never cache a degraded search.
  if (!ask.bypass && ask.ledger.cache === 'miss' && db && response.results.length && !degraded) {
    const payload = packSearch(response);
    const pending = writeSearchCache(db, key, payload).catch(() => undefined);
    if (ask.waitUntil) ask.waitUntil(pending);
    else void pending;
  }

  return { response, late };
}
