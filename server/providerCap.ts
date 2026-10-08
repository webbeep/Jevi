import { d1 } from './auth/env';
import type { Env } from './util';

export type CapBucket = 'eval' | 'prod';

const SLOT_SQL = `INSERT INTO provider_usage (day, provider, bucket, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT(day, provider, bucket) DO UPDATE SET count = count + 1 RETURNING count`;

/** A set numeric cap, or undefined when the variable is absent. */
function readCap(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Built-in daily caps for the free/one-time pools. Serper's 2.5k credits are one-time (~1 month at 80/day). */
const DEFAULT_CAPS: Record<string, Record<CapBucket, number>> = {
  serper: { prod: 80, eval: 300 },
  langsearch: { prod: 300, eval: 300 },
  // Exa is the paid last resort: a strict prod cap and none for eval traffic.
  exa: { prod: 10, eval: 0 },
};

/**
 * Daily cap for this provider and bucket: `<NAME>_DAILY_CAP` (prod) or `<NAME>_EVAL_DAILY_CAP` (eval),
 * else the built-in default for Serper/LangSearch. Other providers are uncapped unless the variable is set.
 */
export function capFor(env: Env, provider: string, bucket: CapBucket): number | undefined {
  const name = `${provider.toUpperCase()}_${bucket === 'eval' ? 'EVAL_' : ''}DAILY_CAP`;
  // 'off' removes even a built-in cap (tests and emergencies).
  if (env[name]?.trim().toLowerCase() === 'off') return undefined;
  return readCap(env[name]) ?? DEFAULT_CAPS[provider]?.[bucket];
}

function logRefusal(provider: string, bucket: CapBucket): void {
  console.log(JSON.stringify({ zo: 'provider-cap', provider, bucket, over: true }));
}

/**
 * Take one daily slot. No cap → true, and D1 is not touched.
 * With no D1 binding or a D1 error, Serper (one-time credit pool) is refused (fail closed);
 * daily-renewing pools such as LangSearch are allowed (fail open).
 */
export async function takeSlot(env: Env, provider: string, bucket: CapBucket, now = Date.now()): Promise<boolean> {
  const cap = capFor(env, provider, bucket);
  if (cap === undefined) return true;
  if (cap === 0) {
    logRefusal(provider, bucket);
    return false;
  }
  const db = d1(env);
  const failClosed = provider === 'serper' || provider === 'exa';
  if (!db) {
    if (failClosed) logRefusal(provider, bucket);
    return !failClosed;
  }
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    const row = await db.prepare(SLOT_SQL).bind(day, provider, bucket).first<{ count: number }>();
    const count = Number(row?.count);
    if (Number.isFinite(count) && count <= cap) return true;
    logRefusal(provider, bucket);
    return false;
  } catch {
    if (failClosed) logRefusal(provider, bucket);
    return !failClosed;
  }
}
