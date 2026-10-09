import { isComposite, matchScore, matches } from '../shared/imagematch';
import type { ImageResult } from '../shared/types';
import { stripHtml } from '../shared/text';
import { type Env, UA, domainOf, fetchJson, hedge } from './util';
import { isBlockedHost } from './spamHosts';

export { matchScore, matches };

const TIMEOUT_MS = 3000;

/** Publisher preview images are allowed unless the deployment opts into open-licensed pictures only. */
export const allowsSourceImages = (env: Env) => env.IMAGE_POLICY !== 'open';

/** Site-wide publisher previews (logos, placeholders, icons) say nothing about the subject. */
const GENERIC_PREVIEW = /logo|fallback|placeholder|default|favicon|\bfav\b|apple-touch|sprite|share[-_]?image|social[-_]?(card|share)|\bicons?\b|blank|spacer|\.(gif|svg|ico)(\?|$)/i;

/** A site-wide preview (logo, favicon, placeholder) rather than a picture of the subject. */
export const isGenericPreview = (url: string) => GENERIC_PREVIEW.test(url.split('#')[0]);

/** Thumbnail hosts YouTube serves its frames from, including the numbered shards ("i1.ytimg.com"). */
const YT_THUMB_HOST = /^(?:i\.ytimg\.com|img\.youtube\.com|i[0-9]\.ytimg\.com)$/i;

/** A YouTube thumbnail names the video it is a frame of in its path ("/vi/<id>/", "/vi_webp/<id>/"). */
const YT_THUMB_PATH = /^\/(?:vi|vi_webp)\/([^/]+)/;

/** A YouTube video id: 9–64 URL-safe characters, long enough to never be a fragment of a longer one. */
const videoId = (s: string) => (/^[\w-]{9,64}$/.test(s) ? s : '');

/** The video a YouTube page url is about (`watch?v=`, youtu.be/<id>, `/shorts/`, `/embed/`), else ''. */
function youTubeVideoId(pageUrl: string): string {
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    return '';
  }
  const host = u.hostname.replace(/^(?:www|m)\./, '').toLowerCase();
  if (host === 'youtu.be') return videoId(u.pathname.slice(1).split('/')[0]!);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return '';
  if (u.pathname.toLowerCase() === '/watch') return videoId(u.searchParams.get('v') ?? '');
  const shorts = /^\/(?:shorts|embed)\/([^/]+)$/i.exec(u.pathname);
  return shorts ? videoId(shorts[1]!) : '';
}

/** The video an i.ytimg.com / img.youtube.com thumbnail is a frame of, else ''. */
function youTubeThumbId(thumb: string): string {
  let u: URL;
  try {
    u = new URL(thumb);
  } catch {
    return '';
  }
  if (!YT_THUMB_HOST.test(u.hostname)) return '';
  const frame = YT_THUMB_PATH.exec(u.pathname);
  return frame ? frame[1]! : '';
}

/**
 * A YouTube picture is a frame of the page's own video. An engine can pair a video page with the
 * thumbnail of an unrelated one (live "Ray Lee Raycon CEO" was served the hq720 frame of a different
 * video — a wrong face), so the ids must agree. Anything that is not a YouTube thumbnail of a
 * YouTube video page is never checked.
 */
export function thumbMatchesPage(img: { url: string; thumb: string }): boolean {
  const frame = youTubeThumbId(img.thumb);
  if (!frame) return true;
  const page = youTubeVideoId(img.url);
  return !page || page === frame;
}

/** Drops pictures the deployment's image policy does not allow, and publisher previews that are just branding. */
export function permitted(images: ImageResult[], env: Env): ImageResult[] {
  // Never hotlink anything that isn't https. Adult/spam hosts never appear as pictures.
  return images.filter((i) => /^https:\/\//i.test(i.thumb) && !isBlockedHost(i.thumb) && !isBlockedHost(i.url) && (i.license !== 'source' || (allowsSourceImages(env) && !GENERIC_PREVIEW.test(i.thumb.split('#')[0]))) && thumbMatchesPage(i));
}

const licenseLabel = (short?: string) => (short ? stripHtml(short).replace(/^cc-/i, 'CC ').trim() : '');

/** Licenses that are impractical or not allowed for commercial reuse (GFDL needs its full text alongside each use). */
const restricted = (license: string) => /\b(GFDL|NC|ND)\b|non-?commercial|no ?deriv|fair use|non-free/i.test(license);

/** A readable author name from Commons' free-form Artist field (drops emails, links and camera notes). */
function author(raw?: string): string {
  const text = stripHtml(raw ?? '').replace(/\S+\s*(@|\[at\]|\(at\))\s*\S+/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const name = text.split(/\s(?:-|–|\||,|\(|Canon|Nikon|Sony|camera)\s?/i)[0].trim();
  return name.length > 40 ? `${name.slice(0, 39).replace(/\s+\S*$/, '')}…` : name;
}

/** Wikipedia's lead image for the best-matching article. `pilicense=free` excludes non-free (fair-use) files. */
async function wikipedia(query: string): Promise<ImageResult[]> {
  const data = await fetchJson<{ query?: { pages?: Record<string, { title: string; index: number; thumbnail?: { source: string }; pageimage?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3&prop=pageimages&piprop=thumbnail|name&pithumbsize=480&pilicense=free&format=json&origin=*`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index).filter((p) => p.thumbnail && p.pageimage && matches(query, p.title));
  if (!pages.length) return [];
  const credits = await fileCredits(pages.map((p) => p.pageimage!)).catch(() => new Map<string, { credit: string; license: string }>());
  return pages.filter((p) => !restricted(credits.get(p.pageimage!.replace(/_/g, ' '))?.license ?? '')).map((p) => ({
    url: `https://en.wikipedia.org/wiki/File:${encodeURIComponent(p.pageimage!)}`,
    thumb: p.thumbnail!.source,
    title: p.title,
    source: 'wikipedia.org',
    license: 'open' as const,
    credit: credits.get(p.pageimage!.replace(/_/g, ' '))?.credit ?? 'Wikipedia',
  }));
}

/** Author and license of Wikipedia/Commons files ("Jane Doe · CC BY-SA 4.0 · Wikimedia"), by file name. */
async function fileCredits(files: string[]): Promise<Map<string, { credit: string; license: string }>> {
  const data = await fetchJson<{ query?: { pages?: Record<string, { title: string; imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }> } }>(
    `https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(files.map((f) => `File:${f}`).join('|'))}&format=json&origin=*`,
    { headers: { 'User-Agent': UA } },
    TIMEOUT_MS,
  );
  const out = new Map<string, { credit: string; license: string }>();
  Object.values(data.query?.pages ?? {}).forEach((p) => {
    const meta = p.imageinfo?.[0]?.extmetadata;
    const license = licenseLabel(meta?.LicenseShortName?.value);
    out.set(p.title.replace(/^File:/, ''), { credit: [author(meta?.Artist?.value), license, 'Wikimedia'].filter(Boolean).join(' · '), license });
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
      const license = licenseLabel(info?.extmetadata?.LicenseShortName?.value);
      if (!info || !/\.(jpe?g|png|webp)$/i.test(info.url) || restricted(license)) return [];
      const artist = author(info.extmetadata?.Artist?.value);
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
    { name: 'commons', run: (q, n) => commons(q, Math.max(6, n)) },
    ...(env.UNSPLASH_ACCESS_KEY ? [{ name: 'unsplash', run: (q: string, n: number) => unsplash(q, env, Math.max(6, n)) }] : []),
    ...(env.PEXELS_API_KEY ? [{ name: 'pexels', run: (q: string, n: number) => pexels(q, env, Math.max(6, n)) }] : []),
    { name: 'openverse', run: (q, n) => openverse(q, Math.max(8, n)) },
    ...(pub && env.BRAVE_API_KEY ? [{ name: 'brave', run: (q: string) => brave(q, env), specificOnly: true }] : []),
  ];
}

/** Lookups by key, including ones still in flight so identical queries share one search. */
const memory = new Map<string, Promise<ImageResult[]>>();
const MEMORY_MAX = 400;
const CACHE_TTL_S = 7 * 24 * 3600;

function cached(key: string, find: () => Promise<ImageResult[]>): Promise<ImageResult[]> {
  const hit = memory.get(key);
  if (hit) return hit;
  const lookup = (async () => {
    const url = `https://zo.page/__images/${encodeURIComponent(key)}`;
    const store = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
    const stored = await store?.match(url).catch(() => undefined);
    if (stored) return (await stored.json()) as ImageResult[];
    const images = await find();
    if (images.length) await store?.put(url, new Response(JSON.stringify(images), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_TTL_S}` } })).catch(() => undefined);
    return images;
  })();
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, lookup);
  // Misses (often timeouts or rate limits) are retried next time rather than remembered.
  void lookup.then((images) => images.length || memory.delete(key), () => memory.delete(key));
  return lookup;
}

/**
 * Finds up to `n` pictures of the exact item named by `query`. Sources are raced
 * with a short stagger; a source only wins when its pictures' titles name the
 * item, best match first. Comparison and collage pictures are skipped. With
 * `allowGeneric` (topic imagery such as a gallery of "Kyoto in autumn") any
 * relevant open or stock picture is acceptable.
 */
export function findImages(query: string, env: Env, n = 1, allowGeneric = false): Promise<ImageResult[]> {
  const key = `v2|${env.IMAGE_POLICY ?? 'source'}|${query.toLowerCase().trim()}|${n}|${allowGeneric ? 'g' : 's'}`;
  return cached(key, async () => {
    const tasks = sources(env).map((s) => async () => {
      const found = (await s.run(query, n)).filter((img) => img.thumb);
      const fitting = (allowGeneric && !s.specificOnly ? found : found.filter((img) => matches(query, img.title))).filter((img) => !isComposite(img));
      const ranked = fitting.map((img) => ({ img, score: matchScore(query, img.title) })).sort((a, b) => b.score - a.score).map((x) => x.img);
      if (!ranked.length) throw new Error(`${s.name}: no matching picture`);
      return ranked.slice(0, n);
    });
    return hedge(tasks, 200).catch(() => [] as ImageResult[]);
  });
}
