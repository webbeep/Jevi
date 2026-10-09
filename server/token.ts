import type { Env } from './util';

/** Constant-time string compare. A length mismatch still walks the longer input. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * True only when `ZO_TEST_TOKEN` is set and the header matches it.
 * An unset token rejects every caller. The header value is never logged.
 */
export function validTestToken(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  return timingSafeEqualStr(presented ?? '', expected);
}

export type TestForce = 'serper-off' | 'degraded';

/**
 * QA-only fault injection: `x-zo-test-force: serper-off | degraded`, honored only with a valid
 * `x-zo-test-token`. serper-off skips Serper for the ask; degraded skips every keyed engine
 * (Wikipedia/backup only). Forced requests bypass every cache read and write.
 */
export function testForce(request: Request, env: Env): TestForce | undefined {
  const raw = request.headers.get('x-zo-test-force')?.trim().toLowerCase();
  if (raw !== 'serper-off' && raw !== 'degraded') return undefined;
  return validTestToken(request.headers.get('x-zo-test-token'), env.ZO_TEST_TOKEN) ? raw : undefined;
}

/** The person pressed Retry: skip saved answers and searches, then save the fresh ones in their place. */
export const wantsRefresh = (request: Request): boolean => request.headers.get('x-zo-refresh') === '1';

/** QA cache bypass: `x-zo-no-cache: 1` (or a forced test fault) is honored only with a valid test token. */
export function cacheBypass(request: Request, env: Env): boolean {
  if (testForce(request, env)) return true;
  if (request.headers.get('x-zo-no-cache') !== '1') return false;
  return validTestToken(request.headers.get('x-zo-test-token'), env.ZO_TEST_TOKEN);
}
