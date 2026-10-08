import { saltedHash, sha256Hex } from './crypto.ts';
import { readCookie, verifyDevice } from './device.ts';
import { authEnabled, d1, intEnv, sessionSecret, testBypass } from './env.ts';
import type { Env } from '../util.ts';
import { currentUser, type ZoUser } from './session.ts';

export type GateReason = 'device' | 'ip' | 'signed';

export type UsageShape = {
  used: number;
  limit: number;
  remaining: number;
  signedIn: boolean;
  day: string;
};

export type GateDeny = {
  need_signin: true;
  used: number;
  limit: number;
  remaining: 0;
  signedIn: boolean;
  reason: GateReason;
};

export type GateDecision = { ok: true; headers?: Record<string, string> } | { ok: false; body: GateDeny };

const DAY = (now: Date) => now.toISOString().slice(0, 10);

export async function bumpUsage(db: D1Database, day: string, key: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO usage (day, subject_key, count) VALUES (?1, ?2, 1)
       ON CONFLICT(day, subject_key) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(day, key)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

const BUMP_SQL = `INSERT INTO usage (day, subject_key, count)
SELECT ?1, k, 1 FROM (
  SELECT ?2 AS k
  UNION ALL SELECT ?3
  UNION ALL SELECT ?4
) WHERE k IS NOT NULL
ON CONFLICT(day, subject_key) DO UPDATE SET count = count + 1
RETURNING subject_key, count`;

const READ_SQL = `SELECT subject_key, count FROM usage
WHERE day = ?1 AND subject_key IN (?2, ?3, ?4)`;

function slotsOf(keys: string[]): Array<string | null> | null {
  const unique = [...new Set(keys.filter((k) => !!k))];
  if (!unique.length) return null;
  return [unique[0] ?? null, unique[1] ?? null, unique[2] ?? null];
}

function countsFrom(rows: Array<{ subject_key: string; count: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.subject_key, Number(row.count));
  return out;
}

/** One upsert for every key that should move. Empty slots are bound as NULL and skipped. */
export async function bumpMany(db: D1Database, day: string, keys: string[]): Promise<Map<string, number>> {
  const slots = slotsOf(keys);
  if (!slots) return new Map();
  const result = await db.prepare(BUMP_SQL).bind(day, slots[0], slots[1], slots[2]).all<{ subject_key: string; count: number }>();
  return countsFrom(result.results);
}

/** K's automatic client retry. A manual Retry button does not send this header. */
export function isAutoRetry(request: Request): boolean {
  return (request.headers.get('x-zo-retry') || '').trim() === '1';
}

/** Uncounted retries of one counted ask. A 4th send inside the window counts. */
const RETRY_FREE_MAX = 3;
const RETRY_WINDOW_MS = 60_000;
const RETRY_PRUNE_MS = 10 * 60_000;

/** trim, collapse whitespace, lowercase. The hash input, not the stored row. */
function normalizeQuestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function retryWindowKey(identity: string, ipKey: string | null, queryHash: string): string {
  return `${identity}\u001f${ipKey ?? ''}\u001f${queryHash}`;
}

const WINDOW_SQL = `INSERT INTO retry_window (key, ts, n) VALUES (?1, ?2, 0)
ON CONFLICT(key) DO UPDATE SET
  n = CASE
    WHEN ?3 = 1 AND retry_window.ts >= ?4 AND retry_window.n < ${RETRY_FREE_MAX} THEN retry_window.n + 1
    ELSE 0
  END,
  ts = CASE
    WHEN ?3 = 1 AND retry_window.ts >= ?4 AND retry_window.n < ${RETRY_FREE_MAX} THEN retry_window.ts
    ELSE ?2
  END`;

/** Bump usage unless this statement's window row is a live free retry (n = 1..MAX, ts inside 60s). */
const COND_BUMP_SQL = `INSERT INTO usage (day, subject_key, count)
SELECT ?1, k, 1 FROM (
  SELECT ?2 AS k
  UNION ALL SELECT ?3
  UNION ALL SELECT ?4
) WHERE k IS NOT NULL
  AND NOT (
    ?5 = 1 AND EXISTS (
      SELECT 1 FROM retry_window
      WHERE key = ?6 AND ts >= ?7 AND n >= 1 AND n <= ${RETRY_FREE_MAX}
    )
  )
ON CONFLICT(day, subject_key) DO UPDATE SET count = count + 1`;

async function questionFrom(request: Request): Promise<string> {
  if (request.body == null) return '';
  try {
    const body = (await request.clone().json()) as { query?: unknown; question?: unknown } | null;
    if (!body || typeof body !== 'object') return '';
    if (typeof body.query === 'string') return body.query;
    if (typeof body.question === 'string') return body.question;
    return '';
  } catch {
    return '';
  }
}

/**
 * One D1 batch: prune, upsert the window, bump usage unless the window says this
 * retry is free, then read the counts. Errors propagate so the caller can count.
 */
async function withRetryWindow(
  db: D1Database,
  day: string,
  slots: Array<string | null>,
  windowKey: string,
  nowMs: number,
  isRetry: boolean,
): Promise<Map<string, number>> {
  const cutoff = nowMs - RETRY_WINDOW_MS;
  const flag = isRetry ? 1 : 0;
  const results = await db.batch([
    db.prepare(`DELETE FROM retry_window WHERE ts < ?1`).bind(nowMs - RETRY_PRUNE_MS),
    db.prepare(WINDOW_SQL).bind(windowKey, nowMs, flag, cutoff),
    db.prepare(COND_BUMP_SQL).bind(day, slots[0], slots[1], slots[2], flag, windowKey, cutoff),
    db.prepare(READ_SQL).bind(day, slots[0], slots[1], slots[2]),
  ]);
  const rows = (results[3]?.results ?? []) as Array<{ subject_key: string; count: number }>;
  return countsFrom(rows);
}

export async function readUsage(db: D1Database, day: string, key: string): Promise<number> {
  const row = await db.prepare(`SELECT count FROM usage WHERE day = ?1 AND subject_key = ?2`).bind(day, key).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export function usageHeaders(used: number, limit: number): Record<string, string> {
  return {
    'X-ZO-Used': String(used),
    'X-ZO-Limit': String(limit),
    'X-ZO-Remaining': String(Math.max(0, limit - used)),
  };
}

export function signedInUser(user: ZoUser | null): user is ZoUser {
  return !!user && !user.anonymous;
}

/** Read-only counter for /api/auth/me and save 401s. Does not increment. */
export async function readFacingUsage(request: Request, env: Env, user: ZoUser | null, now = new Date()): Promise<UsageShape> {
  const day = DAY(now);
  const signedIn = signedInUser(user);
  const limit = signedIn ? intEnv(env, 'GATE_SIGNED_PER_DAY', 100) : intEnv(env, 'GATE_ANON_PER_DAY', 5);
  let used = 0;
  const db = d1(env);
  if (db) {
    try {
      if (signedIn) used = await readUsage(db, day, `u:${user.id}`);
      else {
        const secret = sessionSecret(env);
        const raw = readCookie(request.headers.get('cookie'), 'zo_dev');
        const id = secret && raw ? await verifyDevice(raw, secret) : null;
        if (id) used = await readUsage(db, day, `d:${id}`);
      }
    } catch {
      used = 0;
    }
  }
  used = Math.min(used, limit);
  return { used, limit, remaining: Math.max(0, limit - used), signedIn, day };
}

/** Reported `used` is min(stored count, limit). The row can be one past the cap; the 401 never says limit+1. */
function deny(count: number, limit: number, signedIn: boolean, reason: GateReason): GateDecision {
  return { ok: false, body: { need_signin: true, used: Math.min(count, limit), limit, remaining: 0, signedIn, reason } };
}

/**
 * Daily gate. Counts device, salted IP, and signed-in user.
 * `x-zo-retry: 1` is uncounted only when the same identity (signed-in user id,
 * otherwise the device cookie) and the same salted IP hash already counted this
 * normalized question within 60s, and fewer than 3 free retries have been used
 * for that counted ask. Any other retry counts. The check is one D1 batch.
 * A missing window table or a D1 error counts the ask; if that write also fails,
 * the ask is allowed and nothing is thrown. No D1 binding: allow, no headers.
 * Test token: allow without counting. AUTH_ENABLED off: count and set headers, never 401.
 */
export async function applyGate(
  request: Request,
  env: Env,
  now = new Date(),
  lookup: (request: Request, env: Env, now: Date) => Promise<ZoUser | null> = currentUser,
  question?: string,
): Promise<GateDecision> {
  if (testBypass(request, env)) return { ok: true };
  const db = d1(env);
  if (!db) return { ok: true };

  try {
    const day = DAY(now);
    const secret = sessionSecret(env);
    const limits = {
      anon: intEnv(env, 'GATE_ANON_PER_DAY', 5),
      ip: intEnv(env, 'GATE_IP_PER_DAY', 30),
      signed: intEnv(env, 'GATE_SIGNED_PER_DAY', 100),
    };
    const cookie = readCookie(request.headers.get('cookie'), 'zo_dev');
    const deviceId = secret && cookie ? await verifyDevice(cookie, secret) : null;
    const user = await lookup(request, env, now);
    const signedIn = signedInUser(user);
    const ip = request.headers.get('CF-Connecting-IP');
    const salt = env.IP_HASH_SALT;
    const ipKey = ip && salt ? `ip:${await saltedHash(salt, ip)}` : null;

    const deviceKey = deviceId ? `d:${deviceId}` : null;
    const userKey = signedIn ? `u:${user.id}` : null;
    const facingKey = userKey || deviceKey;
    const facingLimit = userKey ? limits.signed : limits.anon;
    const identity = userKey || deviceKey;
    const tracked = [deviceKey && !userKey ? deviceKey : '', userKey || '', ipKey || ''];
    const slots = slotsOf(tracked);

    let counts = new Map<string, number>();
    if (slots) {
      try {
        if (identity) {
          const text = question !== undefined ? question : await questionFrom(request);
          const queryHash = await sha256Hex(normalizeQuestion(text));
          counts = await withRetryWindow(db, day, slots, retryWindowKey(identity, ipKey, queryHash), now.getTime(), isAutoRetry(request));
        } else {
          counts = await bumpMany(db, day, tracked);
        }
      } catch (err) {
        console.error('retry window skipped', err instanceof Error ? err.name : 'error');
        counts = await bumpMany(db, day, tracked);
      }
    }
    const deviceCount = deviceKey && !userKey ? (counts.get(deviceKey) ?? 0) : 0;
    const userCount = userKey ? (counts.get(userKey) ?? 0) : 0;
    const ipCount = ipKey ? (counts.get(ipKey) ?? 0) : 0;
    const used = userKey ? userCount : deviceCount;
    const headers = facingKey ? usageHeaders(used, facingLimit) : undefined;

    if (!authEnabled(env)) return { ok: true, headers };

    if (!userKey && deviceKey && deviceCount > limits.anon) return deny(deviceCount, limits.anon, false, 'device');
    if (userKey && userCount > limits.signed) return deny(userCount, limits.signed, true, 'signed');
    if (ipKey && ipCount > limits.ip) return deny(ipCount, limits.ip, signedIn, 'ip');
    return { ok: true, headers };
  } catch (err) {
    console.error('usage gate skipped', err instanceof Error ? err.name : 'error');
    return { ok: true };
  }
}
