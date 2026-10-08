/**
 * Workers AI hard cap: <= AI_NEURON_CAP neurons per UTC day (default 10_000),
 * with a 5% reserve so a call that would cross the line is refused.
 * The durable total lives in D1 `ai_budget`. Isolate memory caches that total
 * for 30s so a keystroke does not read D1. Missing DB or a D1 error fails
 * closed (no AI call, no throw).
 *
 * Neuron rates (per 1,000,000 tokens), from
 * https://developers.cloudflare.com/workers-ai/platform/pricing/
 * (Workers AI still bills neurons; $0.011 / 1,000 neurons):
 *   @cf/meta/llama-3.2-1b-instruct            2457 in, 18252 out
 *   @cf/meta/llama-3.1-8b-instruct-fp8-fast   4119 in, 34868 out
 * The answer fallback calls `@cf/meta/llama-3.1-8b-instruct-fast`, which is
 * that fast 8B (fp8-fast on the pricing table). An id that is not listed uses
 * the higher non-fast `@cf/meta/llama-3.1-8b-instruct` rate (25608 in, 75147
 * out) so a rename cannot under-count.
 */
import { markWorkersAiQuota } from './aiQuota.ts';
import type { Env } from './util';

const CACHE_MS = 30_000;
const DEFAULT_CAP = 10_000;

const RATES: Record<string, { inPerM: number; outPerM: number }> = {
  '@cf/meta/llama-3.2-1b-instruct': { inPerM: 2457, outPerM: 18252 },
  '@cf/meta/llama-3.1-8b-instruct-fast': { inPerM: 4119, outPerM: 34868 },
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': { inPerM: 4119, outPerM: 34868 },
  '@cf/meta/llama-3.1-8b-instruct': { inPerM: 25608, outPerM: 75147 },
};

const FALLBACK_RATE = RATES['@cf/meta/llama-3.1-8b-instruct'];

interface BudgetRow {
  neurons: number;
}

interface BudgetStmt {
  bind(...values: unknown[]): { first<T = BudgetRow>(): Promise<T | null> };
}

interface BudgetDb {
  prepare(sql: string): BudgetStmt;
}

const SELECT_SQL = 'SELECT neurons FROM ai_budget WHERE day = ?';
const UPSERT_SQL = `INSERT INTO ai_budget (day, neurons) VALUES (?, ?)
ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons
RETURNING neurons`;

let snap: { day: string; neurons: number; at: number } | null = null;
let reserved = 0;
let closedUntil = 0;
let loading: Promise<number | 'closed'> | null = null;
let loadingDay = '';

const waits = new WeakMap<object, (p: Promise<unknown>) => void>();

export function bindAiWaitUntil(env: object, waitUntil: (p: Promise<unknown>) => void) {
  waits.set(env, waitUntil);
}

/** Clears isolate budget memory. Tests only. */
export function resetAiBudgetState() {
  snap = null;
  reserved = 0;
  closedUntil = 0;
  loading = null;
  loadingDay = '';
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** ceil(chars/4), so a short prompt still counts. */
export function charsToTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export function estimateNeurons(model: string, inTokens: number, outTokens: number): number {
  const rate = RATES[model] ?? FALLBACK_RATE;
  const inT = Number.isFinite(inTokens) && inTokens > 0 ? Math.ceil(inTokens) : 0;
  const outT = Number.isFinite(outTokens) && outTokens > 0 ? Math.ceil(outTokens) : 0;
  if (inT === 0 && outT === 0) return 0;
  const weighted = inT * rate.inPerM + outT * rate.outPerM;
  return Math.max(1, Math.ceil(weighted / 1_000_000));
}

/** Effective ceiling: floor(cap * 0.95). Invalid or negative AI_NEURON_CAP falls back to 10_000. */
export function neuronLimit(env: Env): number {
  const raw = Number(env.AI_NEURON_CAP);
  const cap = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CAP;
  return Math.floor(cap * 0.95);
}

function budgetDb(env: Env): BudgetDb | null {
  const db = (env as { DB?: BudgetDb }).DB;
  if (!db || typeof db.prepare !== 'function') return null;
  return db;
}

function fresh(day: string, now: number): number | undefined {
  if (!snap || snap.day !== day || now - snap.at > CACHE_MS) return undefined;
  return snap.neurons;
}

async function readDb(env: Env, day: string): Promise<number | 'closed'> {
  if (Date.now() < closedUntil) return 'closed';
  const db = budgetDb(env);
  if (!db) {
    closedUntil = Date.now() + CACHE_MS;
    return 'closed';
  }
  try {
    const row = await db.prepare(SELECT_SQL).bind(day).first<BudgetRow>();
    const fromDb = row && Number.isFinite(Number(row.neurons)) ? Number(row.neurons) : 0;
    const local = snap && snap.day === day ? snap.neurons : 0;
    snap = { day, neurons: Math.max(fromDb, local), at: Date.now() };
    return snap.neurons;
  } catch {
    closedUntil = Date.now() + CACHE_MS;
    return 'closed';
  }
}

function load(env: Env, day: string, now: number): Promise<number | 'closed'> {
  const known = fresh(day, now);
  if (known !== undefined) return Promise.resolve(known);
  if (loading && loadingDay === day) return loading;
  loadingDay = day;
  loading = readDb(env, day).finally(() => {
    loading = null;
  });
  return loading;
}

function admit(env: Env, neurons: number, total: number): boolean {
  const limit = neuronLimit(env);
  if (total + reserved >= limit) {
    markWorkersAiQuota();
    return false;
  }
  if (neurons > 0 && total + reserved + neurons > limit) return false;
  reserved += Math.max(0, neurons);
  return true;
}

/**
 * True when `neurons` still fit under the day's limit. Reserves that amount
 * until `charge` or `releaseBudget`. False when the cap is already reached
 * (Workers AI is then skipped until the next UTC midnight, same as a 4006)
 * or when D1 is missing or errors (this call only; no throw).
 */
export function canSpend(env: Env, neurons: number): Promise<boolean> {
  try {
    const now = Date.now();
    const day = utcDay(now);
    const known = fresh(day, now);
    if (known !== undefined) return Promise.resolve(admit(env, neurons, known));
    return load(env, day, now).then((total) => (total === 'closed' ? false : admit(env, neurons, total)), () => false);
  } catch {
    return Promise.resolve(false);
  }
}

function addSnap(day: string, neurons: number) {
  if (!snap || snap.day !== day) snap = { day, neurons, at: Date.now() };
  else snap = { day, neurons: snap.neurons + neurons, at: snap.at };
}

function persist(env: Env, day: string, neurons: number) {
  if (neurons <= 0) return;
  const db = budgetDb(env);
  if (!db) return;
  const write = db
    .prepare(UPSERT_SQL)
    .bind(day, neurons)
    .first<BudgetRow>()
    .then((row) => {
      if (!row || !snap || snap.day !== day) return;
      const got = Number(row.neurons);
      if (Number.isFinite(got)) snap = { day, neurons: Math.max(snap.neurons, got), at: snap.at };
    })
    .catch(() => undefined);
  try {
    const wait = waits.get(env);
    if (wait) wait(write);
    else void write;
  } catch {
    void write;
  }
}

/**
 * Records `neurons` against the UTC day and releases a prior `canSpend` hold
 * (`reserved`, defaulting to `neurons`). The D1 upsert runs in `waitUntil`
 * when `bindAiWaitUntil` ran for this env.
 */
export function charge(env: Env, neurons: number, reservedHold = neurons): void {
  reserved = Math.max(0, reserved - Math.max(0, reservedHold));
  const n = Number.isFinite(neurons) && neurons > 0 ? Math.ceil(neurons) : 0;
  if (n <= 0) return;
  const day = utcDay();
  addSnap(day, n);
  persist(env, day, n);
}

/** Drops a `canSpend` hold when the model was not called. */
export function releaseBudget(reservedHold: number) {
  reserved = Math.max(0, reserved - Math.max(0, reservedHold));
}

export function usageTokens(out: unknown): { inTokens: number; outTokens: number } | undefined {
  if (!out || typeof out !== 'object') return;
  const rec = out as Record<string, unknown>;
  const bag = rec.usage && typeof rec.usage === 'object' ? (rec.usage as Record<string, unknown>) : null;
  if (!bag) return;
  const inn = bag.prompt_tokens ?? bag.input_tokens;
  const outn = bag.completion_tokens ?? bag.output_tokens;
  if (typeof inn !== 'number' && typeof outn !== 'number') return;
  return {
    inTokens: typeof inn === 'number' && inn > 0 ? inn : 0,
    outTokens: typeof outn === 'number' && outn > 0 ? outn : 0,
  };
}

/** Usage tokens when the response has them; otherwise the pre-call ceiling. */
export function neuronsFromResponse(model: string, out: unknown, fallback: number): number {
  const usage = usageTokens(out);
  if (!usage) return fallback;
  return estimateNeurons(model, usage.inTokens, usage.outTokens);
}
