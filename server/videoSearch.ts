import type { SearchResult } from '../shared/types';
import { compareSides } from './patterns';
import { hasProductModel } from './productModel';
import { gateResults } from './relevanceGate';

/** Asks where watching beats reading: highlights, trailers, tutorials, replays. */
const WATCH = /\b(watch|watching|videos?|highlights?|trailers?|tutorials?|clips?|replays?|full game|live ?stream|walkthrough|vlog|music video|official video)\b/i;

export const wantsVideo = (query: string) => WATCH.test(query);

/** A YouTube or Vimeo page that plays in place. */
export const isVideoUrl = (url: string) => /(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/|vimeo\.com\/\d)/.test(url);

const MAX = 3;
const TIMEOUT_MS = 2500;
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; rows: SearchResult[] }>();

interface Renderer {
  videoId?: string;
  title?: { runs?: { text?: string }[] };
  lengthText?: { simpleText?: string };
  publishedTimeText?: { simpleText?: string };
  ownerText?: { runs?: { text?: string }[] };
  detailedMetadataSnippets?: { snippetText?: { runs?: { text?: string }[] } }[];
}

const runs = (r?: { runs?: { text?: string }[] }) => (r?.runs ?? []).map((x) => x.text ?? '').join('').trim();

/** Video rows from a YouTube results page (ytInitialData), in page order, live streams and shorts included. */
export function parseYouTube(html: string): SearchResult[] {
  const start = html.indexOf('var ytInitialData = ');
  if (start < 0) return [];
  const end = html.indexOf(';</script>', start);
  if (end < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start + 'var ytInitialData = '.length, end));
  } catch {
    return [];
  }
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const walk = (o: unknown) => {
    if (out.length >= 10 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
      return;
    }
    const v = (o as { videoRenderer?: Renderer }).videoRenderer;
    if (v?.videoId && /^[\w-]{11}$/.test(v.videoId) && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      const title = runs(v.title);
      const meta = [runs(v.ownerText), v.lengthText?.simpleText, v.publishedTimeText?.simpleText].filter(Boolean).join(' · ');
      const blurb = runs(v.detailedMetadataSnippets?.[0]?.snippetText);
      if (title) {
        out.push({
          title,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          snippet: [meta, blurb].filter(Boolean).join(' — '),
          domain: 'youtube.com',
          engines: ['youtube'],
          image: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        });
      }
      return;
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(data);
  return out;
}

/** Up to three on-topic YouTube videos for a watch ask; [] on any failure (the web results still stand). Keyless. */
export async function videoResults(query: string, doFetch: typeof fetch = fetch): Promise<SearchResult[]> {
  if (!wantsVideo(query)) return [];
  return fetchClips(query, doFetch);
}

/**
 * Sides of a comparison (or the ask itself) that name a numbered product.
 * "Google Fitbit Edge vs Xiaomi Miband 11" searches YouTube for the Mi Band, which is on video
 * before a spec page is indexed. A price ("under $100") or a watch ask is not one of these.
 */
export function productClipQueries(query: string): string[] {
  if (wantsVideo(query)) return [];
  const sides = compareSides(query);
  const pool = sides.length >= 2 ? sides : [query];
  return pool.filter((side) => hasProductModel(side)).slice(0, 2);
}

/**
 * Watch asks search YouTube for the whole question. A numbered product also searches YouTube
 * for that product, so a launch-day review can enter the sources when the web index only has
 * the previous model. [] on any failure.
 */
export async function recallClips(query: string, doFetch: typeof fetch = fetch): Promise<SearchResult[]> {
  if (wantsVideo(query)) return videoResults(query, doFetch);
  const sides = productClipQueries(query);
  if (!sides.length) return [];
  const lists = await Promise.all(sides.map((side) => fetchClips(side, doFetch)));
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const row of lists.flat()) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
    if (out.length >= 4) break;
  }
  return out;
}

/** YouTube rows for one query. Keyless. Never throws. */
async function fetchClips(query: string, doFetch: typeof fetch): Promise<SearchResult[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const started = Date.now();
  try {
    const res = await doFetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        // Skips the EU consent interstitial, which has no results in it.
        cookie: 'SOCS=CAI; CONSENT=YES+1',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`youtube ${res.status}`);
    const rows = gateResults(query, parseYouTube(await res.text())).kept.slice(0, MAX);
    cache.set(key, { at: Date.now(), rows });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    console.log(JSON.stringify({ zo: 'video', n: rows.length, ms: Date.now() - started }));
    return rows;
  } catch (err) {
    console.log(JSON.stringify({ zo: 'video', n: 0, ms: Date.now() - started, error: String(err instanceof Error ? err.message : err).slice(0, 60) }));
    return [];
  }
}

const clipId = (u: string) => u.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|shorts\/([\w-]{11})/)?.slice(1).find(Boolean) ?? u;

/**
 * The best video leads the sources and the rest follow the first few web results, so a watch card has
 * a playable source inside the numbered list the designer reads.
 */
export function withVideos(videos: readonly SearchResult[], web: readonly SearchResult[]): SearchResult[] {
  if (!videos.length) return [...web];
  const ids = new Set(videos.map((v) => clipId(v.url)));
  const rest = web.filter((r) => !ids.has(clipId(r.url)));
  const [lead, ...more] = videos;
  return [lead!, ...rest.slice(0, 3), ...more, ...rest.slice(3)];
}

/**
 * A product review stays behind the written sources. The designer reads the first 12, so the
 * clips sit inside that window without taking the place of a spec page.
 */
export function withProductClips(videos: readonly SearchResult[], web: readonly SearchResult[]): SearchResult[] {
  if (!videos.length) return [...web];
  const ids = new Set(videos.map((v) => clipId(v.url)));
  const rest = web.filter((r) => !ids.has(clipId(r.url)));
  return [...rest.slice(0, 8), ...videos.slice(0, 4), ...rest.slice(8)];
}
