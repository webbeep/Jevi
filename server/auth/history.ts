import { randomId } from './crypto.ts';
import { authEnabled, d1 } from './env.ts';
import { readFacingUsage } from './gate.ts';
import { currentUser, type ZoUser } from './session.ts';
import type { Env } from '../util.ts';
import { json } from '../util.ts';

/**
 * T446: signed-in ask history and today's usage for the profile panel.
 * - The stream records every counted signed-in search/follow-up (`recordAsk`).
 * - The client reports the finished card back once (`POST /api/history/card`) so a tap reopens it.
 * - `GET /api/account/usage` returns counts only, from the same D1 counter the gate uses.
 */
const CARD_MAX = 64 * 1024;
const QUERY_MAX = 500;
const PAGE = 20;
/** A finished card attaches to that question's latest row within this window. */
const ATTACH_MS = 30 * 60_000;
/** The same question again within this window (auto-retry, reconnect) is one row. */
const DEDUPE_MS = 60_000;

type Row = { id: string; query: string; kind: string; created_at: string; has_card?: number; card_json?: string | null };

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const normalize = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase();
const hashOf = (q: string) => sha256Hex(normalize(q));

/** Called from /api/stream after the gate let a signed-in ask through. Never throws. */
export async function recordAsk(env: Env, userId: string, query: string, kind: 'search' | 'followup', now = new Date()): Promise<void> {
  const db = d1(env);
  const q = query.trim().slice(0, QUERY_MAX);
  if (!db || !q) return;
  try {
    const hash = await hashOf(q);
    const at = now.toISOString();
    const since = new Date(now.getTime() - DEDUPE_MS).toISOString();
    await db
      .prepare(
        `INSERT INTO ask_history (id, user_id, query, query_hash, kind, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE NOT EXISTS (SELECT 1 FROM ask_history WHERE user_id = ?2 AND query_hash = ?4 AND created_at >= ?7)`,
      )
      .bind(randomId(), userId, q, hash, kind, at, since)
      .run();
  } catch (err) {
    console.error('history record failed', err instanceof Error ? err.name : 'error');
  }
}

async function signedUser(request: Request, env: Env): Promise<ZoUser | null> {
  const user = await currentUser(request, env);
  return user && !user.anonymous ? user : null;
}

function nextUtcMidnight(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/** GET /api/account/usage: today's count for this session (account, else device), its cap and the reset time. */
export async function handleUsage(request: Request, env: Env, now = new Date()): Promise<Response> {
  const user = await currentUser(request, env);
  const usage = await readFacingUsage(request, env, user, now);
  return json(
    { used: usage.used, limit: usage.limit, remaining: usage.remaining, signedIn: usage.signedIn, day: usage.day, resetAt: nextUtcMidnight(now) },
    200,
    { 'cache-control': 'private, no-store' },
  );
}

function off(env: Env): Response | null {
  if (!authEnabled(env) || !d1(env)) return json({ error: 'Sign-in is disabled' }, 404);
  return null;
}

/** Cursor: `<created_at>~<id>` of the last row on the previous page. */
function parseCursor(raw: string | null): { at: string; id: string } | null {
  if (!raw) return null;
  const i = raw.lastIndexOf('~');
  if (i <= 0) return null;
  return { at: raw.slice(0, i), id: raw.slice(i + 1) };
}

/** GET /api/history?limit=20&before=<cursor> → { items: [{ id, query, kind, created_at, card }], next } */
export async function handleHistoryList(request: Request, env: Env): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  const db = d1(env)!;
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('limit') ?? PAGE);
  const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, Math.floor(raw))) : PAGE;
  const cursor = parseCursor(url.searchParams.get('before'));
  try {
    const result = await db
      .prepare(
        `SELECT id, query, kind, created_at, card_json IS NOT NULL AS has_card FROM ask_history
         WHERE user_id = ?1 AND (?2 IS NULL OR created_at < ?2 OR (created_at = ?2 AND id < ?3))
         ORDER BY created_at DESC, id DESC
         LIMIT ?4`,
      )
      .bind(user.id, cursor?.at ?? null, cursor?.id ?? '', limit + 1)
      .all<Row>();
    const rows = result.results;
    const more = rows.length > limit;
    const items = (more ? rows.slice(0, limit) : rows).map((r) => ({ id: r.id, query: r.query, kind: r.kind, created_at: r.created_at, card: Number(r.has_card) === 1 }));
    const last = items[items.length - 1];
    return json({ items, next: more && last ? `${last.created_at}~${last.id}` : null }, 200, { 'cache-control': 'private, no-store' });
  } catch (err) {
    console.error('history list failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

/** GET /api/history/:id → { id, query, kind, created_at, card | null } */
export async function handleHistoryItem(request: Request, env: Env, id: string): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  if (!id) return json({ error: 'Not found' }, 404);
  try {
    const row = await d1(env)!
      .prepare(`SELECT id, query, kind, created_at, card_json FROM ask_history WHERE id = ?1 AND user_id = ?2`)
      .bind(id, user.id)
      .first<Row>();
    if (!row) return json({ error: 'Not found' }, 404);
    let card: unknown = null;
    try {
      card = JSON.parse(row.card_json || 'null');
    } catch {
      card = null;
    }
    return json({ id: row.id, query: row.query, kind: row.kind, created_at: row.created_at, card }, 200, { 'cache-control': 'private, no-store' });
  } catch (err) {
    console.error('history get failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

/** POST /api/history/card { query, card }: attach the finished card to that question's latest row (last 30 min). */
export async function handleHistoryCard(request: Request, env: Env, now = new Date()): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  let body: { query?: unknown; card?: unknown };
  try {
    body = (await request.json()) as { query?: unknown; card?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, QUERY_MAX) : '';
  if (!query || !body.card || typeof body.card !== 'object') return json({ error: 'Invalid card' }, 400);
  const cardJson = JSON.stringify(body.card);
  if (new TextEncoder().encode(cardJson).length > CARD_MAX) return json({ error: 'Card is too large' }, 413);
  try {
    const since = new Date(now.getTime() - ATTACH_MS).toISOString();
    const result = await d1(env)!
      .prepare(
        `UPDATE ask_history SET card_json = ?1
         WHERE id = (SELECT id FROM ask_history WHERE user_id = ?2 AND query_hash = ?3 AND created_at >= ?4 ORDER BY created_at DESC, id DESC LIMIT 1)`,
      )
      .bind(cardJson, user.id, await hashOf(query), since)
      .run();
    return json({ ok: true, attached: (result.meta?.changes ?? 0) > 0 });
  } catch (err) {
    console.error('history card failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
