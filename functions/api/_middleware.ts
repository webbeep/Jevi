import { Env, json } from '../../server/util';

/**
 * Per-IP rate limit for /api/*. Fixed 60s window, kept in isolate memory: best-effort
 * on Cloudflare (each isolate counts on its own), $0 and no binding needed.
 * Limits: RL_STREAM_PER_MIN (default 30) for /api/stream, RL_TYPEAHEAD_PER_MIN
 * (default 120) for /api/suggest-typeahead, RL_API_PER_MIN (default 60) for the
 * rest. /api/health is exempt. Set a limit to 0 to disable it.
 */
const WINDOW_MS = 60_000;
const MAX_KEYS = 5_000;
const hits = new Map<string, { start: number; count: number }>();

const limitFor = (env: Env, name: string, fallback: number) => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/api/health' || request.method === 'OPTIONS') return next();

  const isStream = path === '/api/stream';
  const isTypeahead = path === '/api/suggest-typeahead';
  const limit = isTypeahead
    ? limitFor(env, 'RL_TYPEAHEAD_PER_MIN', 120)
    : isStream
      ? limitFor(env, 'RL_STREAM_PER_MIN', 30)
      : limitFor(env, 'RL_API_PER_MIN', 60);
  if (limit === 0) return next();

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${isTypeahead ? 't' : isStream ? 's' : 'a'}:${ip}`;
  const now = Date.now();
  let entry = hits.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (hits.size >= MAX_KEYS) {
      for (const [k, v] of hits) if (now - v.start >= WINDOW_MS) hits.delete(k);
      if (hits.size >= MAX_KEYS) hits.clear();
    }
    entry = { start: now, count: 0 };
    hits.set(key, entry);
  }
  entry.count += 1;

  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 1000));
    return json({ error: 'Too many requests, slow down and try again shortly.' }, 429, { 'Retry-After': String(retryAfter) });
  }
  return next();
};
