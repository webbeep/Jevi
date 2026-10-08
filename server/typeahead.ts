/**
 * Prefix completions for the home input. Workers AI when the binding is
 * present; isolate LRU + Cache API in front. Failures return an empty list
 * so the client can fall back to history and starters.
 */
import { normalizePrefix } from '../shared/typeahead.ts';
import { isQuotaError, markWorkersAiQuota, nextUtcMidnight, workersAiQuotaDown } from './aiQuota.ts';
import type { Env } from './util';

export { normalizePrefix };

const DEFAULT_MODEL = '@cf/meta/llama-3.2-1b-instruct';
const AI_TIMEOUT_MS = 800;
const MEM_MAX = 500;

export interface TypeaheadResponse {
  suggestions: string[];
  source: 'ai' | 'cache' | 'none';
  ms: number;
  /** Why AI gave nothing (timeout, error class/message, empty parse). No secrets: provider error text only. */
  reason?: string;
}

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

const mem = new Map<string, string[]>();

/** After a quota error (4006: daily free neurons used) skip AI until the next 00:00 UTC reset; other errors back off 60s. */
let aiDownUntil = 0;
function markAiDown(why: string, now = Date.now()) {
  if (isQuotaError(why)) {
    markWorkersAiQuota(now);
    aiDownUntil = nextUtcMidnight(now);
  } else if (why !== 'timeout') {
    aiDownUntil = now + 60_000;
  }
}

function memGet(key: string): string[] | undefined {
  const hit = mem.get(key);
  if (!hit) return;
  mem.delete(key);
  mem.set(key, hit);
  return hit;
}

function memSet(key: string, value: string[]) {
  if (!value.length) return;
  if (mem.has(key)) mem.delete(key);
  mem.set(key, value);
  while (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

function cacheKey(prefix: string): string {
  return `https://typeahead.cache/v1?q=${encodeURIComponent(prefix)}`;
}

function none(t0: number, reason?: string): TypeaheadResponse {
  return { suggestions: [], source: 'none', ms: Date.now() - t0, ...(reason ? { reason: reason.slice(0, 160) } : {}) };
}

function stripLine(line: string): string {
  let s = line.trim();
  s = s.replace(/^\d+[.)\-:\]]\s*/, '');
  s = s.replace(/^[-*•–—]\s*/, '');
  s = s.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '');
  return s.trim().replace(/\s+/g, ' ');
}

/** Split a model reply into 3–5 cleaned completions. Exported for unit tests. */
export function parseAiLines(text: string, prefix: string): string[] {
  const p = normalizePrefix(prefix);
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let s = stripLine(line);
    if (!s) continue;
    if (s.length > 80) s = s.slice(0, 80).trimEnd();
    const key = s.toLowerCase();
    if (!key || key === p || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(s);
  }
  const first = p.split(' ')[0] ?? '';
  let picked = cleaned;
  if (first.length >= 2) {
    const shared = cleaned.filter((s) => s.toLowerCase().startsWith(first));
    if (shared.length >= 3) picked = shared;
  }
  return picked.slice(0, 5);
}

function extractText(out: unknown): string {
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object' && 'response' in out) {
    const response = (out as { response: unknown }).response;
    return typeof response === 'string' ? response : '';
  }
  return '';
}

async function readEdgeCache(prefix: string): Promise<string[] | undefined> {
  if (typeof caches === 'undefined') return;
  try {
    const hit = await caches.default.match(new Request(cacheKey(prefix)));
    if (!hit) return;
    const data = (await hit.json()) as { suggestions?: unknown };
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 5) : [];
    return suggestions.length ? suggestions : undefined;
  } catch {
    return;
  }
}

async function writeEdgeCache(prefix: string, suggestions: string[]) {
  if (typeof caches === 'undefined' || !suggestions.length) return;
  try {
    await caches.default.put(
      new Request(cacheKey(prefix)),
      new Response(JSON.stringify({ suggestions }), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      }),
    );
  } catch {
    /* cache is best-effort */
  }
}

export async function suggestTypeahead(q: string, env: Env): Promise<TypeaheadResponse> {
  const t0 = Date.now();
  const prefix = normalizePrefix(q);
  if (prefix.length < 3) return none(t0);

  const remembered = memGet(prefix);
  if (remembered) return { suggestions: remembered, source: 'cache', ms: Date.now() - t0 };

  const edge = await readEdgeCache(prefix);
  if (edge) {
    memSet(prefix, edge);
    return { suggestions: edge, source: 'cache', ms: Date.now() - t0 };
  }

  if (env.TYPEAHEAD === 'off') return none(t0, 'off');
  const ai = (env as Record<string, unknown>).AI as AiBinding | undefined;
  if (!ai || typeof ai.run !== 'function') return none(t0, 'no binding');
  if (Date.now() < aiDownUntil || workersAiQuotaDown()) return none(t0, 'ai cooling down');

  const model = env.TYPEAHEAD_MODEL || DEFAULT_MODEL;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      ai.run(model, {
        messages: [
          { role: 'system', content: 'You complete everyday search queries. Reply with exactly 5 lines, no numbering, no quotes, no extra prose.' },
          { role: 'user', content: `Return 5 short everyday search-query completions that start with or extend this prefix. One per line, no numbering.\nPrefix: ${prefix}` },
        ],
        max_tokens: 60,
        temperature: 0.2,
      }).then((v) => ({ ok: true as const, v })).catch((e: unknown) => ({ ok: false as const, why: `error: ${e instanceof Error ? e.message : String(e)}` })),
      new Promise<{ ok: false; why: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, why: 'timeout' }), AI_TIMEOUT_MS);
      }),
    ]);
    if (!raced.ok) {
      markAiDown(raced.why);
      return none(t0, raced.why);
    }
    const text = extractText(raced.v);
    const suggestions = parseAiLines(text, prefix);
    if (!suggestions.length) return none(t0, `empty: ${typeof raced.v === 'object' && raced.v ? Object.keys(raced.v).join(',') : typeof raced.v} ${text.slice(0, 60)}`);
    memSet(prefix, suggestions);
    await writeEdgeCache(prefix, suggestions);
    return { suggestions, source: 'ai', ms: Date.now() - t0 };
  } catch (e) {
    return none(t0, `error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
