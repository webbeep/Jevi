import type {
  Discussion,
  EngineStatus,
  Freshness,
  ImageResult,
  Knowledge,
  SearchResponse,
  SearchResult,
} from '../shared/types';
import { parseDuckDuckGo } from '../shared/text';
import { Env, UA, clip, domainOf, fetchJson, fetchText, hedge, stripHtml } from './util';

interface Query {
  q: string;
  freshness: Freshness;
  count: number;
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  date?: string;
}

interface EngineOutput {
  hits: Hit[];
  images?: ImageResult[];
}

interface Engine {
  name: string;
  enabled: (env: Env) => boolean;
  run: (q: Query, env: Env) => Promise<EngineOutput>;
}

const ENGINE_TIMEOUT_MS = 6500;
const EARLY_RETURN_MS = 2200;
const EARLY_RETURN_HITS = 12;

function freshnessCode(f: Freshness, codes: Record<Exclude<Freshness, 'any'>, string>): string | undefined {
  return f === 'any' ? undefined : codes[f];
}

const brave: Engine = {
  name: 'brave',
  enabled: (env) => !!env.BRAVE_API_KEY,
  async run(q, env) {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', q.q);
    u.searchParams.set('count', String(Math.min(q.count, 20)));
    const fresh = freshnessCode(q.freshness, { day: 'pd', week: 'pw', month: 'pm', year: 'py' });
    if (fresh) u.searchParams.set('freshness', fresh);
    const data = await fetchJson<{
      web?: { results?: { title: string; url: string; description: string; age?: string; thumbnail?: { src?: string } }[] };
    }>(u.toString(), { headers: { 'X-Subscription-Token': env.BRAVE_API_KEY!, Accept: 'application/json' } }, ENGINE_TIMEOUT_MS);
    return {
      hits: (data.web?.results ?? []).map((r) => ({
        title: stripHtml(r.title),
        url: r.url,
        snippet: stripHtml(r.description ?? ''),
        date: r.age,
        image: r.thumbnail?.src,
      })),
    };
  },
};

const tavily: Engine = {
  name: 'tavily',
  enabled: (env) => !!env.TAVILY_API_KEY,
  async run(q, env) {
    const data = await fetchJson<{
      results?: { title: string; url: string; content: string; published_date?: string }[];
      images?: (string | { url: string; description?: string })[];
    }>(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q.q,
          max_results: Math.min(q.count, 20),
          include_images: true,
          time_range: q.freshness === 'any' ? undefined : q.freshness,
        }),
      },
      ENGINE_TIMEOUT_MS,
    );
    return {
      hits: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: clip(r.content ?? '', 320), date: r.published_date })),
      images: (data.images ?? []).map((img) => {
        const url = typeof img === 'string' ? img : img.url;
        return { url, thumb: url, title: typeof img === 'string' ? '' : img.description ?? '', source: domainOf(url) };
      }),
    };
  },
};

const serper: Engine = {
  name: 'serper',
  enabled: (env) => !!env.SERPER_API_KEY,
  async run(q, env) {
    const tbs = freshnessCode(q.freshness, { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' });
    const data = await fetchJson<{ organic?: { title: string; link: string; snippet?: string; date?: string; imageUrl?: string }[] }>(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: { 'X-API-KEY': env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q.q, num: Math.min(q.count, 20), tbs }),
      },
      ENGINE_TIMEOUT_MS,
    );
    return {
      hits: (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '', date: r.date, image: r.imageUrl })),
    };
  },
};

const jina: Engine = {
  name: 'jina',
  enabled: (env) => !!env.JINA_API_KEY,
  async run(q, env) {
    const data = await fetchJson<{ data?: { title: string; url: string; description?: string; date?: string }[] }>(
      `https://s.jina.ai/?q=${encodeURIComponent(q.q)}`,
      { headers: { Authorization: `Bearer ${env.JINA_API_KEY}`, Accept: 'application/json', 'X-Respond-With': 'no-content' } },
      ENGINE_TIMEOUT_MS,
    );
    return { hits: (data.data ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '', date: r.date })) };
  },
};

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const duckduckgo: Engine = {
  name: 'duckduckgo',
  enabled: () => true,
  async run(q) {
    const df = freshnessCode(q.freshness, { day: 'd', week: 'w', month: 'm', year: 'y' });
    const params = `q=${encodeURIComponent(q.q)}${df ? `&df=${df}` : ''}`;
    const html = `https://html.duckduckgo.com/html/?${params}`;
    const lite = `https://lite.duckduckgo.com/lite/?${params}`;
    const attempt = (url: string) => async () => {
      const hits = parseDuckDuckGo(await fetchText(url, { headers: { 'User-Agent': BROWSER_UA } }, ENGINE_TIMEOUT_MS - 1000));
      if (!hits.length) throw new Error('no results');
      return { hits };
    };
    return hedge([attempt(lite), attempt(html), attempt(`https://api.allorigins.win/raw?url=${encodeURIComponent(html)}`)], 900);
  },
};

const bing: Engine = {
  name: 'bing',
  enabled: () => true,
  async run(q) {
    const fresh = freshnessCode(q.freshness, { day: 'ez1', week: 'ez2', month: 'ez3', year: 'ez5' });
    const xml = await fetchText(
      `https://www.bing.com/search?format=rss&count=20&q=${encodeURIComponent(q.q)}${fresh ? `&filters=${encodeURIComponent(`ex1:"${fresh}"`)}` : ''}`,
      { headers: { 'User-Agent': BROWSER_UA } },
      ENGINE_TIMEOUT_MS,
    );
    const tag = (item: string, name: string) => stripHtml(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
    const hits = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
      title: tag(item, 'title'),
      url: tag(item, 'link'),
      snippet: tag(item, 'description'),
      date: tag(item, 'pubDate') || undefined,
    }));
    return { hits };
  },
};

const DEFAULT_SEARXNG = ['https://searx.be', 'https://search.inetol.net', 'https://priv.au', 'https://searx.tiekoetter.com'];

const searxng: Engine = {
  name: 'searxng',
  enabled: () => true,
  async run(q, env) {
    const instances = env.SEARXNG_URLS ? env.SEARXNG_URLS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SEARXNG;
    const range = freshnessCode(q.freshness, { day: 'day', week: 'week', month: 'month', year: 'year' });
    return hedge(
      instances.map((base) => async () => {
        const u = new URL('/search', base);
        u.searchParams.set('q', q.q);
        u.searchParams.set('format', 'json');
        if (range) u.searchParams.set('time_range', range);
        const data = await fetchJson<{
          results?: { title: string; url: string; content?: string; publishedDate?: string; img_src?: string; thumbnail?: string }[];
        }>(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } }, ENGINE_TIMEOUT_MS - 1000);
        const hits = (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: stripHtml(r.content ?? ''),
          date: r.publishedDate ?? undefined,
          image: r.thumbnail || r.img_src || undefined,
        }));
        if (!hits.length) throw new Error('no results');
        return { hits };
      }),
      600,
    );
  },
};

const wikipedia: Engine = {
  name: 'wikipedia',
  enabled: () => true,
  async run(q) {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    Object.entries({ action: 'query', list: 'search', srsearch: q.q, format: 'json', srlimit: '4', origin: '*' }).forEach(([k, v]) =>
      u.searchParams.set(k, v),
    );
    const data = await fetchJson<{ query?: { search?: { title: string; snippet: string }[] } }>(
      u.toString(),
      { headers: { 'User-Agent': UA } },
      ENGINE_TIMEOUT_MS,
    );
    return {
      hits: (data.query?.search ?? []).map((r) => ({
        title: r.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
        snippet: stripHtml(r.snippet),
      })),
    };
  },
};

const marginalia: Engine = {
  name: 'marginalia',
  enabled: () => true,
  async run(q, env) {
    const key = env.MARGINALIA_API_KEY || 'public';
    const data = await fetchJson<{ results?: { url: string; title: string; description?: string }[] }>(
      `https://api.marginalia.nu/${key}/search/${encodeURIComponent(q.q)}?count=10`,
      { headers: { 'User-Agent': UA } },
      ENGINE_TIMEOUT_MS,
    );
    return { hits: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' })) };
  },
};

const WEB_ENGINES: Engine[] = [brave, tavily, serper, jina, duckduckgo, bing, marginalia, searxng, wikipedia];

export function keyedEngines(env: Env): string[] {
  return [brave, tavily, serper, jina].filter((e) => e.enabled(env)).map((e) => e.name);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => u.searchParams.delete(k));
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

const ENGINE_WEIGHT: Record<string, number> = { brave: 1.2, serper: 1.2, tavily: 1.1, jina: 1.1, marginalia: 0.5, wikipedia: 0.8 };

/** Reciprocal rank fusion across engines, so results found by several engines rise. */
function fuse(outputs: { engine: string; hits: Hit[] }[], count: number): SearchResult[] {
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
      } else {
        merged.set(key, { ...hit, domain: domainOf(hit.url), engines: [engine], score });
      }
    });
  }
  return [...merged.values()]
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

async function images(q: string): Promise<ImageResult[]> {
  const openverse = async () => {
    const data = await fetchJson<{ results?: { url: string; thumbnail?: string; title?: string; foreign_landing_url?: string }[] }>(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=12&mature=false`,
      { headers: { 'User-Agent': UA } },
      4500,
    );
    const out = (data.results ?? []).map((r) => ({
      url: r.foreign_landing_url ?? r.url,
      thumb: r.thumbnail ?? r.url,
      title: r.title ?? '',
      source: domainOf(r.foreign_landing_url ?? r.url),
    }));
    if (!out.length) throw new Error('no images');
    return out;
  };
  const commons = async () => {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    Object.entries({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: q,
      gsrlimit: '12',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '480',
      format: 'json',
      origin: '*',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const data = await fetchJson<{
      query?: { pages?: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string }[] }> };
    }>(u.toString(), { headers: { 'User-Agent': UA } }, 4500);
    const out = Object.values(data.query?.pages ?? {})
      .map((p) => p.imageinfo?.[0] && { url: p.imageinfo[0].descriptionurl, thumb: p.imageinfo[0].thumburl ?? p.imageinfo[0].url, title: p.title.replace(/^File:|\.\w+$/g, ''), source: 'commons.wikimedia.org' })
      .filter((x): x is ImageResult => !!x && /\.(jpe?g|png|webp)/i.test(x.thumb));
    if (!out.length) throw new Error('no images');
    return out;
  };
  return hedge([openverse, commons], 1200);
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

export async function search(q: Query, env: Env): Promise<SearchResponse> {
  const engines = WEB_ENGINES.filter((e) => e.enabled(env));
  const statuses: EngineStatus[] = [];

  const done: { engine: string; hits: Hit[]; images?: ImageResult[] }[] = [];
  const allEngines = Promise.all(
    engines.map(async (engine) => {
      const started = Date.now();
      try {
        const out = await engine.run(q, env);
        statuses.push({ name: engine.name, ok: true, count: out.hits.length, ms: Date.now() - started });
        done.push({ engine: engine.name, ...out });
      } catch (err) {
        const error = err instanceof AggregateError ? 'all mirrors failed' : err instanceof Error ? err.message : String(err);
        statuses.push({ name: engine.name, ok: false, count: 0, ms: Date.now() - started, error });
      }
    }),
  );
  const enoughEarly = new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const webHits = done.filter((d) => d.engine !== 'wikipedia').reduce((n, d) => n + d.hits.length, 0);
      if (Date.now() - startedAt >= EARLY_RETURN_MS && webHits >= EARLY_RETURN_HITS) {
        clearInterval(tick);
        resolve();
      }
    }, 150);
    void allEngines.finally(() => clearInterval(tick));
  });
  const webPromise = Promise.race([allEngines, enoughEarly]).then(() => {
    const finished = new Set(statuses.map((s) => s.name));
    engines.filter((e) => !finished.has(e.name)).forEach((e) => statuses.push({ name: e.name, ok: false, count: 0, ms: 0, error: 'skipped (slow)' }));
    return [...done];
  });

  const [web, instant, imgs, hn] = await Promise.all([
    webPromise,
    settle(instantAnswer(q.q), undefined),
    settle(images(q.q), [] as ImageResult[]),
    settle(discussions(q.q), [] as Discussion[]),
  ]);

  const results = fuse(web, q.count);
  const wikiTop = web.find((w) => w.engine === 'wikipedia')?.hits[0];
  const knowledge = instant ?? (wikiTop ? await settle(wikiSummary(wikiTop.title), undefined) : undefined);

  const seen = new Set<string>();
  const allImages = [
    ...(knowledge?.image ? [{ url: knowledge.url, thumb: knowledge.image, title: knowledge.title, source: domainOf(knowledge.url) }] : []),
    ...web.flatMap((w) => w.images ?? []),
    ...imgs,
  ].filter((img) => img.thumb && !seen.has(img.thumb) && seen.add(img.thumb));

  return {
    query: q.q,
    freshness: q.freshness,
    results,
    images: allImages.slice(0, 16),
    knowledge,
    discussions: hn,
    engines: statuses.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
