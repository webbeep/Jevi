import type { ImageResult } from '../shared/types';
import { stripHtml } from '../shared/text';
import { type Env, UA, domainOf, fetchJson, hedge } from './util';

const TIMEOUT_MS = 3000;
const STOP = new Set(['the', 'and', 'for', 'with', 'photo', 'image', 'picture', 'of', 'in', 'a', 'an', 'on', 'at', 'to']);

/** Publisher preview images are allowed unless the deployment opts into open-licensed pictures only. */
export const allowsSourceImages = (env: Env) => env.IMAGE_POLICY !== 'open';

/** Drops pictures the deployment's image policy does not allow. */
export function permitted(images: ImageResult[], env: Env): ImageResult[] {
  return allowsSourceImages(env) ? images : images.filter((i) => i.license !== 'source');
}

/** Significant words of an image query, used to check that a found picture is of that exact item. */
function keywords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of the item's words that the picture's title mentions (0-1). */
export function matchScore(query: string, title: string): number {
  const words = keywords(query);
  if (!words.length) return 1;
  const t = title.toLowerCase();
  return words.filter((w) => t.includes(w)).length / words.length;
}

/** A picture counts as specific when its title names most of the item. */
const matches = (query: string, title: string) => matchScore(query, title) >= (keywords(query).length <= 2 ? 1 : 0.6);

const licenseLabel = (short?: string) => (short ? stripHtml(short).replace(/^cc-/i, 'CC ').trim() : '');

/** Wikipedia's lead image for the best-matching article. `pilicense=free` excludes non-free (fair-use) files. */
async function wikipedia(query: string): Promise<ImageResult[]> {
  const data = await fetchJson<{ query?: { pages?: Record<string, { title: string; index: number; thumbnail?: { source: string }; pageimage?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3&prop=pageimages&piprop=thumbnail|name&pithumbsize=480&pilicense=free&format=json&origin=*`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index).filter((p) => p.thumbnail && p.pageimage && matches(query, p.title));
  if (!pages.length) return [];
  const credits = await fileCredits(pages.map((p) => p.pageimage!)).catch(() => new Map<string, string>());
  return pages.map((p) => ({
    url: `https://en.wikipedia.org/wiki/File:${encodeURIComponent(p.pageimage!)}`,
    thumb: p.thumbnail!.source,
    title: p.title,
    source: 'wikipedia.org',
    license: 'open' as const,
    credit: credits.get(p.pageimage!.replace(/_/g, ' ')) ?? 'Wikipedia',
  }));
}

/** Author and license of Wikipedia/Commons files ("Jane Doe · CC BY-SA 4.0 · Wikimedia"), by file name. */
async function fileCredits(files: string[]): Promise<Map<string, string>> {
  const data = await fetchJson<{ query?: { pages?: Record<string, { title: string; imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(files.map((f) => `File:${f}`).join('|'))}&format=json&origin=*`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  const out = new Map<string, string>();
  Object.values(data.query?.pages ?? {}).forEach((p) => {
    const meta = p.imageinfo?.[0]?.extmetadata;
    const artist = stripHtml(meta?.Artist?.value ?? '').slice(0, 60);
    out.set(p.title.replace(/^File:/, ''), [artist, licenseLabel(meta?.LicenseShortName?.value), 'Wikimedia'].filter(Boolean).join(' · '));
  });
  return out;
}

/** Wikimedia Commons file search; every file there is freely licensed. */
export async function commons(query: string, n = 6): Promise<ImageResult[]> {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(n),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName',
    iiurlwidth: '480',
    format: 'json',
    origin: '*',
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  const data = await fetchJson<{
    query?: { pages?: Record<string, { title: string; index: number; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[] }> };
  }>(u.toString(), { headers: { 'User-Agent': UA } }, TIMEOUT_MS);
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => {
      const info = p.imageinfo?.[0];
      if (!info || !/\.(jpe?g|png|webp)$/i.test(info.url)) return [];
      const artist = stripHtml(info.extmetadata?.Artist?.value ?? '').slice(0, 60);
      const license = licenseLabel(info.extmetadata?.LicenseShortName?.value);
      return [{
        url: info.descriptionurl,
        thumb: info.thumburl ?? info.url,
        title: p.title.replace(/^File:|\.\w+$/g, '').replace(/[_-]+/g, ' '),
        source: 'commons.wikimedia.org',
        license: 'open' as const,
        credit: [artist, license, 'Wikimedia Commons'].filter(Boolean).join(' · '),
      }];
    });
}

/** Openverse, restricted to licenses that allow commercial use. */
export async function openverse(query: string, n: number): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { url: string; thumbnail?: string; title?: string; foreign_landing_url?: string; creator?: string; license?: string; license_version?: string; provider?: string }[] }>(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${n}&mature=false&license_type=commercial`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  return (data.results ?? []).map((r) => ({
    url: r.foreign_landing_url ?? r.url,
    thumb: r.thumbnail ?? r.url,
    title: r.title ?? '',
    source: domainOf(r.foreign_landing_url ?? r.url),
    license: 'open' as const,
    credit: [r.creator, r.license && `${r.license === 'cc0' || r.license === 'pdm' ? r.license.toUpperCase() : `CC ${r.license.toUpperCase()}`} ${r.license_version ?? ''}`.trim(), r.provider].filter(Boolean).join(' · '),
  }));
}

async function pexels(query: string, env: Env, n: number): Promise<ImageResult[]> {
  const data = await fetchJson<{ photos?: { url: string; alt?: string; photographer?: string; src: { medium: string } }[] }>(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${n}`,
    { headers: { Authorization: env.PEXELS_API_KEY! } },
    TIMEOUT_MS,
  );
  return (data.photos ?? []).map((p) => ({ url: p.url, thumb: p.src.medium, title: p.alt ?? '', source: 'pexels.com', license: 'stock' as const, credit: `${p.photographer ?? 'Photo'} · Pexels` }));
}

/** Unsplash requires hotlinking its URLs and crediting the photographer with referral links. */
async function unsplash(query: string, env: Env, n: number): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { alt_description?: string; description?: string; urls: { small: string }; links: { html: string }; user?: { name?: string } }[] }>(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${n}&content_filter=high`,
    { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' } },
    TIMEOUT_MS,
  );
  return (data.results ?? []).map((p) => ({
    url: `${p.links.html}?utm_source=zo&utm_medium=referral`,
    thumb: p.urls.small,
    title: p.alt_description ?? p.description ?? '',
    source: 'unsplash.com',
    license: 'stock' as const,
    credit: `${p.user?.name ?? 'Photo'} · Unsplash`,
  }));
}

/** Publisher preview images of pages that match the item (search-engine style thumbnails). */
async function exa(query: string, env: Env): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { title?: string; url: string; image?: string }[] }>(
    'https://api.exa.ai/search',
    { method: 'POST', headers: { 'x-api-key': env.EXA_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, numResults: 5, type: 'fast' }) },
    TIMEOUT_MS,
  );
  return (data.results ?? []).filter((r) => r.image).map((r) => ({ url: r.url, thumb: r.image!, title: r.title ?? '', source: domainOf(r.url), license: 'source' as const, credit: domainOf(r.url) }));
}

async function brave(query: string, env: Env): Promise<ImageResult[]> {
  const data = await fetchJson<{ results?: { title: string; url: string; thumbnail?: { src: string } }[] }>(
    `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { 'X-Subscription-Token': env.BRAVE_API_KEY!, Accept: 'application/json' } },
    TIMEOUT_MS,
  );
  return (data.results ?? []).filter((r) => r.thumbnail).map((r) => ({ url: r.url, thumb: r.thumbnail!.src, title: r.title, source: domainOf(r.url), license: 'source' as const, credit: domainOf(r.url) }));
}

type Source = (query: string, n: number) => Promise<ImageResult[]>;

/** Sources in the order they are tried; each later one starts a little after the previous. */
function sources(env: Env): { name: string; run: Source; specificOnly?: boolean }[] {
  const pub = allowsSourceImages(env);
  return [
    { name: 'wikipedia', run: (q) => wikipedia(q), specificOnly: true },
    ...(pub && env.EXA_API_KEY ? [{ name: 'exa', run: (q: string) => exa(q, env), specificOnly: true }] : []),
    { name: 'commons', run: (q, n) => commons(q, Math.max(6, n)) },
    ...(env.UNSPLASH_ACCESS_KEY ? [{ name: 'unsplash', run: (q: string, n: number) => unsplash(q, env, Math.max(6, n)) }] : []),
    ...(env.PEXELS_API_KEY ? [{ name: 'pexels', run: (q: string, n: number) => pexels(q, env, Math.max(6, n)) }] : []),
    { name: 'openverse', run: (q, n) => openverse(q, Math.max(8, n)) },
    ...(pub && env.BRAVE_API_KEY ? [{ name: 'brave', run: (q: string) => brave(q, env), specificOnly: true }] : []),
  ];
}

const memory = new Map<string, ImageResult[]>();
const MEMORY_MAX = 400;
const CACHE_TTL_S = 7 * 24 * 3600;

async function cached(key: string, find: () => Promise<ImageResult[]>): Promise<ImageResult[]> {
  const hit = memory.get(key);
  if (hit) return hit;
  const url = `https://zo.page/__images/${encodeURIComponent(key)}`;
  const store = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const stored = await store?.match(url).catch(() => undefined);
  if (stored) {
    const images = (await stored.json()) as ImageResult[];
    memory.set(key, images);
    return images;
  }
  const images = await find();
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, images);
  if (images.length) await store?.put(url, new Response(JSON.stringify(images), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_TTL_S}` } })).catch(() => undefined);
  return images;
}

/**
 * Finds up to `n` pictures of the exact item named by `query`. Sources are raced
 * with a short stagger; a source only wins when its pictures' titles name the
 * item, best match first. With `allowGeneric` (topic imagery such as a gallery
 * of "Kyoto in autumn") any relevant open or stock picture is acceptable.
 */
export function findImages(query: string, env: Env, n = 1, allowGeneric = false): Promise<ImageResult[]> {
  const key = `${env.IMAGE_POLICY ?? 'source'}|${query.toLowerCase().trim()}|${n}|${allowGeneric ? 'g' : 's'}`;
  return cached(key, async () => {
    const tasks = sources(env).map((s) => async () => {
      const found = (await s.run(query, n)).filter((img) => img.thumb);
      const fitting = allowGeneric && !s.specificOnly ? found : found.filter((img) => matches(query, img.title));
      const ranked = fitting.map((img) => ({ img, score: matchScore(query, img.title) })).sort((a, b) => b.score - a.score).map((x) => x.img);
      if (!ranked.length) throw new Error(`${s.name}: no matching picture`);
      return ranked.slice(0, n);
    });
    return hedge(tasks, 200).catch(() => [] as ImageResult[]);
  });
}
