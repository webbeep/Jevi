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

/** QA cache bypass: `x-zo-no-cache: 1` is honored only with a valid test token. */
export function cacheBypass(request: Request, env: Env): boolean {
  if (request.headers.get('x-zo-no-cache') !== '1') return false;
  return validTestToken(request.headers.get('x-zo-test-token'), env.ZO_TEST_TOKEN);
}
