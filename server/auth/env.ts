import type { Env } from '../util.ts';
import { safeEqual } from './crypto.ts';

/** D1 binding, when Infra has attached it. Missing or non-D1 values are treated as absent. */
export function d1(env: Env): D1Database | undefined {
  const db = (env as { DB?: D1Database }).DB;
  if (!db || typeof db.prepare !== 'function') return undefined;
  return db;
}

export function sessionSecret(env: Env): string | undefined {
  const s = env.SESSION_SECRET || env.BETTER_AUTH_SECRET;
  return s && s.length >= 16 ? s : undefined;
}

/** AUTH_ENABLED must be explicitly on. Unset and false count usage but never block. */
export function authEnabled(env: Env): boolean {
  const v = (env.AUTH_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function intEnv(env: Env, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** True only when ZO_TEST_TOKEN is set and the header matches in constant time. */
export function testBypass(request: Request, env: Env): boolean {
  const expected = env.ZO_TEST_TOKEN;
  if (!expected) return false;
  return safeEqual(request.headers.get('x-zo-test-token') || '', expected);
}
