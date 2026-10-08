import { isBriefingQuery } from '../shared/recency.ts';
import type { EngineStatus, Freshness, SearchResult } from '../shared/types';
import type { Env } from './util';

const UA = 'Mozilla/5.0 (compatible; ZoBot/1.0; +https://zo.page)';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Off unless the deployment sets ZO_SOCIAL=1. One keyless Bluesky search, no account. */
export const SOCIAL_TIMEOUT_MS = 1500;
const SOCIAL_LIMIT = 5;
const APPVIEW = 'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts';

/**
 * Time-sensitive asks only. Reuses the planner heuristic (news / latest / today / update → briefing)
 * and the freshness the caller already computed (understand uses day/week for "now").
 */
export function wantsSocial(query: string, freshness: Freshness): boolean {
  if (freshness === 'day' || freshness === 'week') return true;
  return isBriefingQuery(query);
}

interface ExternalEmbed {
  title?: string;
  description?: string;
}

interface BskyPost {
  uri?: string;
  author?: { handle?: string };
  record?: { text?: string; createdAt?: string; embed?: { external?: ExternalEmbed } };
  embed?: { external?: ExternalEmbed };
}

export interface SocialPost {
  handle: string;
  url: string;
  title: string;
  snippet: string;
  date?: string;
}

function externalOf(post: BskyPost): ExternalEmbed | undefined {
  return post.embed?.external ?? post.record?.embed?.external;
}

/** Turns an app.bsky.feed.searchPosts body into posts with a handle, URL and timestamp. */
export function parseBlueskySearch(data: unknown, limit = SOCIAL_LIMIT): SocialPost[] {
  const posts = data && typeof data === 'object' && Array.isArray((data as { posts?: unknown }).posts) ? ((data as { posts: BskyPost[] }).posts) : [];
  const out: SocialPost[] = [];
  for (const post of posts) {
    if (out.length >= limit) break;
    const handle = post.author?.handle?.replace(/^@/, '').trim();
    const rkey = post.uri?.split('/').pop();
    if (!handle || !rkey || !post.uri?.includes('/app.bsky.feed.post/')) continue;
    const ext = externalOf(post);
    const text = (post.record?.text ?? '').replace(/\s+/g, ' ').trim();
    const extra = (ext?.description || ext?.title || '').replace(/\s+/g, ' ').trim();
    const body = text || extra;
    if (!body) continue;
    out.push({
      handle,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      title: clip(text || ext?.title || body, 140),
      snippet: clip(`@${handle}: ${body}`, 320),
      date: post.record?.createdAt,
    });
  }
  return out;
}

export function socialSources(posts: SocialPost[]): SearchResult[] {
  return posts.slice(0, SOCIAL_LIMIT).map((p) => ({
    title: p.title,
    url: p.url,
    snippet: p.snippet,
    domain: 'bsky.app',
    engines: ['bluesky'],
    date: p.date,
  }));
}

/** One searchPosts call. public.api.bsky.app 403s from this network; the AppView host is the documented unauthenticated fallback. */
export async function blueskySearch(query: string, timeoutMs = SOCIAL_TIMEOUT_MS): Promise<SocialPost[]> {
  const u = new URL(APPVIEW);
  u.searchParams.set('q', query.slice(0, 200));
  u.searchParams.set('limit', String(SOCIAL_LIMIT));
  u.searchParams.set('sort', 'latest');
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBlueskySearch(await res.json());
}

/**
 * At most one call, and only for a full (non-lite) time-sensitive search when ZO_SOCIAL=1.
 * Any error, including timeout, is an empty list so the web search still answers.
 */
export async function maybeBluesky(
  q: { q: string; freshness: Freshness; lite?: boolean },
  env: Env,
): Promise<{ posts: SocialPost[]; status?: EngineStatus }> {
  if (env.ZO_SOCIAL !== '1' || q.lite || !wantsSocial(q.q, q.freshness)) return { posts: [] };
  const started = Date.now();
  try {
    const posts = await blueskySearch(q.q);
    return { posts, status: { name: 'bluesky', ok: true, count: posts.length, ms: Date.now() - started } };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'social search failed';
    return { posts: [], status: { name: 'bluesky', ok: false, count: 0, ms: Date.now() - started, error } };
  }
}
