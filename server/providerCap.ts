import { d1 } from './auth/env';
import type { Env } from './util';

export type CapBucket = 'eval' | 'prod' | 'test';

/**
 * The test site (jevi.pages.dev) shares this database with production. Its asks count in their own bucket, so a
 * benchmark run there never spends the daily search quota zo.fyi's visitors draw on.
 */
export function capBucket(scope: { eval?: boolean; test?: boolean }): CapBucket {
  return scope.eval ? 'eval' : scope.test ? 'test' : 'prod';
}

/** A request to the test deployment: jevi.pages.dev or one of its preview hosts. */
export function testHost(url: string | undefined): boolean {
  try {
    const host = new URL(url ?? '').hostname;
    return host === 'jevi.pages.dev' || host.endsWith('.jevi.pages.dev');
  } catch {
    return false;
  }
}

const SLOT_SQL = `INSERT INTO provider_usage (day, provider, bucket, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT(day, provider, bucket) DO UPDATE SET count = count + 1 WHERE count < ?4 RETURNING count`;
// At the cap the update is a no-op and returns no row, so refused calls never push `used` past `cap`.

/** A set numeric cap, or undefined when the variable is absent. */
function readCap(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/**
 * Built-in daily caps. Serper Starter is a prepaid 50,000-credit pack (about six months),
 * not the old 2,500-credit grant the 200/day prod ration was protecting. 10,000/day lets
 * live search stay on Serper; a day that actually hits the ceiling still lasts about a
 * month of the pack. Eval is the bench bucket and spends the same credits. These are not
 * the per-person ask gates.
 */
const DEFAULT_CAPS: Record<string, Record<CapBucket, number>> = {
  serper: { prod: 10000, eval: 200, test: 3100 },
  langsearch: { prod: 300, eval: 300, test: 100 },
  // You.com keyless MCP free profile (~100/day total). Stored under bucket 'shared'
  // so prod+eval share one counter (the free MCP is ~100/day per IP, not 200).
  'you-keyless': { prod: 100, eval: 100, test: 100 },
  // Exa is the paid last resort: a strict prod cap and none for eval traffic.
  exa: { prod: 10, eval: 0, test: 0 },
  // Free tiers: Tavily ~1,000 credits a month (~30/day), Firecrawl 500 one-time credits. Late fallbacks only.
  tavily: { prod: 30, eval: 0, test: 0 },
  firecrawl: { prod: 10, eval: 0, test: 0 },
};

/**
 * Daily cap for this provider and bucket: `<NAME>_DAILY_CAP` (prod) or `<NAME>_EVAL_DAILY_CAP` (eval),
 * else the built-in default for Serper/LangSearch. Other providers are uncapped unless the variable is set.
 */
export function capFor(env: Env, provider: string, bucket: CapBucket): number | undefined {
  const name = `${provider.toUpperCase()}_${bucket === 'eval' ? 'EVAL_' : bucket === 'test' ? 'TEST_' : ''}DAILY_CAP`;
  // 'off' removes even a built-in cap (tests and emergencies).
  if (env[name]?.trim().toLowerCase() === 'off') return undefined;
  return readCap(env[name]) ?? DEFAULT_CAPS[provider]?.[bucket];
}

function logRefusal(provider: string, bucket: CapBucket): void {
  console.log(JSON.stringify({ zo: 'provider-cap', provider, bucket, over: true }));
}

/**
 * Take one daily slot. No cap → true, and D1 is not touched.
 * With no D1 binding or a D1 error, Serper (prepaid credit pack) is refused (fail closed);
 * daily-renewing pools such as LangSearch are allowed (fail open).
 */
/** Providers whose free quota is one pool for the day (prod+eval share a counter). */
const SHARED_DAY = new Set(['you-keyless']);

/** D1 bucket key: 'shared' for you-keyless so prod and eval share the 100/day MCP quota. */
export function usageBucket(provider: string, bucket: CapBucket): string {
  return SHARED_DAY.has(provider) ? 'shared' : bucket;
}

/**
 * Serper prod is a prepaid credit pack. Signed-out asks may use at most this share of the prod
 * day, so signed-in asks still get Serper at the evening peak; the Serper /images extra stops at half the day.
 */
export const SERPER_ANON_SHARE = 0.7;
export const SERPER_IMAGES_SHARE = 0.5;
/** Serper prod alert threshold: /api/health sets serper.prod.alert once today's use reaches this share of the cap. */
export const SERPER_ALERT_SHARE = 0.8;

export async function takeSlot(env: Env, provider: string, bucket: CapBucket, now = Date.now(), share = 1): Promise<boolean> {
  // Shared providers: one daily cap (prod default), counted once across buckets.
  const cap = SHARED_DAY.has(provider)
    ? (env.YOU_KEYLESS_DAILY_CAP?.trim().toLowerCase() === 'off' ? undefined : readCap(env.YOU_KEYLESS_DAILY_CAP) ?? DEFAULT_CAPS[provider]?.prod)
    : capFor(env, provider, bucket);
  if (cap === undefined) return true;
  // A share below 1 refuses once the day's count reaches that part of the cap (at least one slot).
  const limit = share < 1 ? Math.max(1, Math.floor(cap * share)) : cap;
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
  const store = usageBucket(provider, bucket);
  try {
    const row = await db.prepare(SLOT_SQL).bind(day, provider, store, limit).first<{ count: number }>();
    const count = Number(row?.count);
    if (Number.isFinite(count) && count <= limit) {
      if (provider === 'serper' && bucket === 'prod' && count === Math.ceil(cap * SERPER_ALERT_SHARE)) {
        console.log(JSON.stringify({ zo: 'provider-alert', provider, bucket, used: count, cap, share: SERPER_ALERT_SHARE }));
      }
      return true;
    }
    logRefusal(provider, bucket);
    return false;
  } catch {
    if (failClosed) logRefusal(provider, bucket);
    return !failClosed;
  }
}

export interface ProviderUsage {
  used: number;
  cap: number | null;
  /** Serper prod only: true once used >= 80% of cap. */
  alert?: boolean;
}

/** Today's (UTC) counts and caps per capped provider and bucket, for /api/health. Counts only, never keys. */
export async function usageToday(env: Env, now = Date.now()): Promise<Record<string, Record<CapBucket, ProviderUsage>> | undefined> {
  const db = d1(env);
  if (!db) return undefined;
  const day = new Date(now).toISOString().slice(0, 10);
  const out: Record<string, Record<CapBucket, ProviderUsage>> = {};
  const providers = new Set(Object.keys(DEFAULT_CAPS));
  let rows: { provider: string; bucket: string; count: number }[] = [];
  try {
    rows = (await db.prepare('SELECT provider, bucket, count FROM provider_usage WHERE day = ?1').bind(day).all<{ provider: string; bucket: string; count: number }>()).results ?? [];
  } catch {
    return undefined;
  }
  for (const r of rows) providers.add(r.provider);
  for (const p of providers) {
    if (SHARED_DAY.has(p)) {
      const used = Number(rows.find((r) => r.provider === p && r.bucket === 'shared')?.count
        ?? rows.filter((r) => r.provider === p).reduce((n, r) => n + Number(r.count || 0), 0));
      const cap = (env.YOU_KEYLESS_DAILY_CAP?.trim().toLowerCase() === 'off' ? null : readCap(env.YOU_KEYLESS_DAILY_CAP) ?? DEFAULT_CAPS[p]?.prod ?? null);
      out[p] = { prod: { used, cap }, eval: { used, cap }, test: { used, cap } };
      continue;
    }
    const used = (b: CapBucket) => Number(rows.find((r) => r.provider === p && r.bucket === b)?.count ?? 0);
    out[p] = {
      prod: { used: used('prod'), cap: capFor(env, p, 'prod') ?? null },
      eval: { used: used('eval'), cap: capFor(env, p, 'eval') ?? null },
      test: { used: used('test'), cap: capFor(env, p, 'test') ?? null },
    };
    if (p === 'serper') {
      const c = out[p].prod.cap;
      out[p].prod.alert = c != null && c > 0 && out[p].prod.used >= Math.ceil(c * SERPER_ALERT_SHARE);
    }
  }
  return out;
}
