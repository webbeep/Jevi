import { packHistoryPayload, packHistorySources, unpackHistoryPayload } from '../../shared/historyCard.ts';
import type { AnswerCard } from '../../shared/card.ts';
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
    let raw: unknown = null;
    try {
      raw = JSON.parse(row.card_json || 'null');
    } catch {
      raw = null;
    }
    const unpacked = unpackHistoryPayload(raw);
    return json({ id: row.id, query: row.query, kind: row.kind, created_at: row.created_at, card: unpacked.card, results: unpacked.results }, 200, { 'cache-control': 'private, no-store' });
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
  let body: { query?: unknown; card?: unknown; results?: unknown };
  try {
    body = (await request.json()) as { query?: unknown; card?: unknown; results?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, QUERY_MAX) : '';
  if (!query || !body.card || typeof body.card !== 'object') return json({ error: 'Invalid card' }, 400);
  const results = packHistorySources(Array.isArray(body.results) ? body.results : []);
  const cardJson = JSON.stringify(packHistoryPayload(body.card as AnswerCard, results));
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

function parsedCard(raw: string | null | undefined): ReturnType<typeof unpackHistoryPayload> {
  try {
    return unpackHistoryPayload(JSON.parse(raw || 'null'));
  } catch {
    return { card: null, results: [] };
  }
}

/** POST /api/history/:id: opening that row moves it to the front. */
export async function handleHistoryTouch(request: Request, env: Env, id: string, now = new Date()): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  if (!id) return json({ error: 'Not found' }, 404);
  try {
    const result = await d1(env)!
      .prepare(`UPDATE ask_history SET created_at = ?1 WHERE id = ?2 AND user_id = ?3`)
      .bind(now.toISOString(), id, user.id)
      .run();
    return json({ ok: true, moved: (result.meta?.changes ?? 0) > 0 });
  } catch (err) {
    console.error('history touch failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

/**
 * POST /api/history/touch { query }: move that question to the front and return its card.
 * A miss is `{ moved: false, card: null }` so the client can search instead.
 */
export async function handleHistoryTouchQuery(request: Request, env: Env, now = new Date()): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, QUERY_MAX) : '';
  if (!query) return json({ error: 'Invalid query' }, 400);
  try {
    const db = d1(env)!;
    const row = await db
      .prepare(`SELECT id, query, card_json FROM ask_history WHERE user_id = ?1 AND query_hash = ?2 ORDER BY created_at DESC, id DESC LIMIT 1`)
      .bind(user.id, await hashOf(query))
      .first<Row>();
    if (!row) return json({ ok: true, moved: false, card: null, results: [] });
    const at = now.toISOString();
    await db.prepare(`UPDATE ask_history SET created_at = ?1 WHERE id = ?2 AND user_id = ?3`).bind(at, row.id, user.id).run();
    const unpacked = parsedCard(row.card_json);
    return json({ ok: true, moved: true, id: row.id, query: row.query, created_at: at, card: unpacked.card, results: unpacked.results });
  } catch (err) {
    console.error('history touch failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

/** DELETE /api/history: drop this account's ask history. Device history is cleared by the client. */
export async function handleHistoryDelete(request: Request, env: Env): Promise<Response> {
  const disabled = off(env);
  if (disabled) return disabled;
  const user = await signedUser(request, env);
  if (!user) return json({ need_signin: true }, 401);
  try {
    await d1(env)!.prepare(`DELETE FROM ask_history WHERE user_id = ?1`).bind(user.id).run();
    return json({ ok: true });
  } catch (err) {
    console.error('history delete failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
