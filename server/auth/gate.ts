import { saltedHash } from './crypto.ts';
import { readCookie, verifyDevice } from './device.ts';
import { authEnabled, d1, intEnv, sessionSecret, testBypass } from './env.ts';
import type { Env } from '../util.ts';
import { currentUser, type ZoUser } from './session.ts';

export type GateReason = 'device' | 'ip' | 'signed';

export type GateDecision =
  | { ok: true; headers?: Record<string, string> }
  | { ok: false; body: { need_signin: true; used: number; limit: number; reason: GateReason } };

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

export async function readUsage(db: D1Database, day: string, key: string): Promise<number> {
  const row = await db.prepare(`SELECT count FROM usage WHERE day = ?1 AND subject_key = ?2`).bind(day, key).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export function usageHeaders(used: number, limit: number): Record<string, string> {
  return { 'X-ZO-Used': String(used), 'X-ZO-Limit': String(limit) };
}

/**
 * Daily gate. Counts device, salted IP, and signed-in user.
 * No D1 binding: allow, no headers. Test token: allow without counting.
 * AUTH_ENABLED off: count and set headers, never 401.
 */
export async function applyGate(
  request: Request,
  env: Env,
  now = new Date(),
  lookup: (request: Request, env: Env) => Promise<ZoUser | null> = currentUser,
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
    const user = await lookup(request, env);
    const signedIn = !!user && !user.anonymous;
    const ip = request.headers.get('CF-Connecting-IP');
    const salt = env.IP_HASH_SALT;
    const ipKey = ip && salt ? `ip:${await saltedHash(salt, ip)}` : null;

    const deviceKey = deviceId ? `d:${deviceId}` : null;
    const userKey = signedIn && user ? `u:${user.id}` : null;
    const facingKey = userKey || deviceKey;
    const facingLimit = userKey ? limits.signed : limits.anon;

    const deviceCount = deviceKey && !userKey ? await bumpUsage(db, day, deviceKey) : 0;
    const userCount = userKey ? await bumpUsage(db, day, userKey) : 0;
    const ipCount = ipKey ? await bumpUsage(db, day, ipKey) : 0;
    const used = userKey ? userCount : deviceCount;
    const headers = facingKey ? usageHeaders(used, facingLimit) : undefined;

    if (!authEnabled(env)) return { ok: true, headers };

    if (!userKey && deviceKey && deviceCount > limits.anon) {
      return { ok: false, body: { need_signin: true, used: deviceCount, limit: limits.anon, reason: 'device' } };
    }
    if (userKey && userCount > limits.signed) {
      return { ok: false, body: { need_signin: true, used: userCount, limit: limits.signed, reason: 'signed' } };
    }
    if (ipKey && ipCount > limits.ip) {
      return { ok: false, body: { need_signin: true, used: ipCount, limit: limits.ip, reason: 'ip' } };
    }
    return { ok: true, headers };
  } catch (err) {
    console.error('usage gate skipped', err instanceof Error ? err.name : 'error');
    return { ok: true };
  }
}
