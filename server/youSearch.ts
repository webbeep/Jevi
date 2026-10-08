/**
 * You.com search adapters.
 * - Keyed: REST search when YOU_API_KEY / YDC_API_KEY is set (api.ydc-index.io).
 * - Keyless: MCP JSON-RPC over SSE at api.you.com/mcp?profile=free (you-search tool).
 * Engine names never reach the client (publicPayload maps them to "web").
 */
import type { ImageResult } from '../shared/types';
import { HttpStatusError, type Env, clip, domainOf, fetchJson } from './util';
import type { WebHit } from './cascade';

const MCP_URL = 'https://api.you.com/mcp?profile=free';
const KEYED_URL = 'https://api.ydc-index.io/search';
const TIMEOUT_MS = 6500;

export interface YouWebRow {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  page_age?: string;
  thumbnail_url?: string;
}

export interface YouSearchPayload {
  results?: { web?: YouWebRow[]; news?: YouWebRow[] };
  web?: YouWebRow[];
}

/** Map You.com web rows into the cascade WebHit shape. */
export function mapYouHits(payload: YouSearchPayload): { hits: WebHit[]; images: ImageResult[] } {
  const rows = payload.results?.web ?? payload.web ?? [];
  const hits: WebHit[] = [];
  const images: ImageResult[] = [];
  for (const r of rows) {
    const url = (r.url ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const title = (r.title ?? '').trim() || domainOf(url);
    const snippet = clip(r.description ?? r.snippet ?? '', 320);
    hits.push({
      title,
      url,
      snippet,
      date: r.page_age || undefined,
      image: r.thumbnail_url && /^https:\/\//i.test(r.thumbnail_url) ? r.thumbnail_url : undefined,
    });
    if (r.thumbnail_url && /^https:\/\//i.test(r.thumbnail_url)) {
      images.push({
        url,
        thumb: r.thumbnail_url,
        title,
        source: domainOf(url),
        license: 'source',
        credit: domainOf(url),
      });
    }
  }
  return { hits, images: images.slice(0, 8) };
}

/** Parse MCP SSE text and pull the tools/call result payload (ignores notifications). */
export function parseYouMcpSse(raw: string): YouSearchPayload {
  const frames: string[] = [];
  let data = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) data += line.slice(5).trimStart();
    else if (!line.trim() && data) {
      frames.push(data);
      data = '';
    }
  }
  if (data) frames.push(data);

  for (const frame of frames) {
    let obj: unknown;
    try {
      obj = JSON.parse(frame);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const rec = obj as { result?: { content?: { type?: string; text?: string }[]; structuredContent?: unknown }; error?: { message?: string; code?: number } };
    if (rec.error) {
      const msg = rec.error.message ?? 'you mcp error';
      const code = typeof rec.error.code === 'number' ? rec.error.code : 502;
      throw new HttpStatusError(code >= 400 && code < 600 ? code : 502, msg);
    }
    if (!rec.result) continue;
    const structured = rec.result.structuredContent;
    if (structured && typeof structured === 'object') return structured as YouSearchPayload;
    const text = rec.result.content?.find((c) => c.type === 'text')?.text;
    if (!text) continue;
    try {
      return JSON.parse(text) as YouSearchPayload;
    } catch {
      throw new HttpStatusError(502, 'you mcp: unreadable content');
    }
  }
  throw new HttpStatusError(502, 'you mcp: empty result');
}

function youKey(env: Env): string | undefined {
  const k = env.YOU_API_KEY?.trim() || env.YDC_API_KEY?.trim();
  return k || undefined;
}

/** Authenticated You.com search (only when a key is set). */
export async function youKeyedSearch(query: string, env: Env, count = 10): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const key = youKey(env);
  if (!key) return { hits: [], images: [] };
  const url = `${KEYED_URL}?query=${encodeURIComponent(query)}&num_web_results=${count}`;
  const data = await fetchJson<YouSearchPayload & { error?: { message?: string } }>(
    url,
    { headers: { 'X-API-Key': key, Accept: 'application/json' } },
    TIMEOUT_MS,
  );
  if (data.error?.message) throw new HttpStatusError(402, data.error.message);
  return mapYouHits(data);
}

/** Keyless free-profile MCP you-search. One POST; no initialize required (stateless). */
export async function youKeylessSearch(query: string, _env: Env, count = 10): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'you-search', arguments: { query, count } },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpStatusError(res.status, text.slice(0, 200));
    const payload = parseYouMcpSse(text);
    return mapYouHits(payload);
  } catch (err) {
    if (err instanceof HttpStatusError) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw new HttpStatusError(408, 'you keyless timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const youKeyPresent = (env: Env) => !!youKey(env);
