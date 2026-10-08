import type { Env } from './util';

const KEY = 'engine-skip:v1';
const SKIP_MS = 10 * 60 * 1000;
const READ_MS = 20_000;
const TTL_SEC = 600;

const TRIP_REASONS = new Set(['payment', 'quota', 'unavailable', 'credit']);

interface SkipEntry {
  until: number;
  reason: string;
}

let cache: { at: number; raw: Record<string, SkipEntry> } | undefined;

export function clearSkipCache(): void {
  cache = undefined;
}

function live(raw: Record<string, SkipEntry>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (entry && typeof entry.until === 'number' && entry.until > now) out[name] = entry.until;
  }
  return out;
}

function asMap(value: unknown): Record<string, SkipEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, SkipEntry> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object') continue;
    const until = (entry as { until?: unknown }).until;
    const reason = (entry as { reason?: unknown }).reason;
    if (typeof until === 'number' && typeof reason === 'string') out[name] = { until, reason };
  }
  return out;
}

async function readKv(env: Env): Promise<Record<string, SkipEntry>> {
  const kv = env.ENGINE_SKIP;
  if (!kv) return {};
  const text = await kv.get(KEY);
  if (!text) return {};
  return asMap(JSON.parse(text) as unknown);
}

/** Until-timestamps for engines other isolates have tripped. Missing KV or any error is an empty list. */
export async function loadSkips(env: Env, now = Date.now()): Promise<Record<string, number>> {
  if (cache && now - cache.at < READ_MS) return live(cache.raw, now);
  let raw: Record<string, SkipEntry> = {};
  try {
    raw = await readKv(env);
  } catch {
    raw = {};
  }
  cache = { at: now, raw };
  return live(raw, now);
}

/**
 * Remember a payment, quota, unavailable, or credit failure for SKIP_MS.
 * The module cache updates immediately. The KV put is handed to waitUntil when
 * the caller has one; otherwise it is awaited. Never throws.
 */
export async function tripSkip(env: Env, engine: string, reason: string, waitUntil?: (promise: Promise<unknown>) => void): Promise<void> {
  if (!TRIP_REASONS.has(reason)) return;
  const now = Date.now();
  const until = now + SKIP_MS;
  const raw = { ...liveEntries(cache?.raw, now), [engine]: { until, reason } };
  cache = { at: cache?.at ?? now, raw };
  const task = writeSkip(env, raw);
  try {
    if (waitUntil) waitUntil(task);
    else await task;
  } catch {
    /* never throw */
  }
}

function liveEntries(raw: Record<string, SkipEntry> | undefined, now: number): Record<string, SkipEntry> {
  if (!raw) return {};
  const out: Record<string, SkipEntry> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (entry.until > now) out[name] = entry;
  }
  return out;
}

async function writeSkip(env: Env, raw: Record<string, SkipEntry>): Promise<void> {
  try {
    const kv = env.ENGINE_SKIP;
    if (!kv) return;
    let current: Record<string, SkipEntry> = {};
    try {
      current = await readKv(env);
    } catch {
      current = {};
    }
    const now = Date.now();
    const merged = { ...liveEntries(current, now), ...liveEntries(raw, now) };
    await kv.put(KEY, JSON.stringify(merged), { expirationTtl: TTL_SEC });
  } catch {
    /* never throw */
  }
}
