import { randomId } from './crypto.ts';
import { d1 } from './env.ts';
import { readFacingUsage } from './gate.ts';
import { currentUser, type ZoUser } from './session.ts';
import type { Env } from '../util.ts';
import { json } from '../util.ts';

const CARD_MAX = 64 * 1024;

type SaveRow = { id: string; query: string; title: string; created_at: string; card_json?: string };

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cardBytes(card: unknown): number {
  return new TextEncoder().encode(JSON.stringify(card)).length;
}

async function signedOut(request: Request, env: Env, user: ZoUser | null): Promise<Response> {
  const usage = await readFacingUsage(request, env, user && user.anonymous ? user : null);
  return json({ need_signin: true, used: usage.used, limit: usage.limit, remaining: usage.remaining, signedIn: false }, 401);
}

async function requireUser(request: Request, env: Env): Promise<ZoUser | Response> {
  const user = await currentUser(request, env);
  if (!user || user.anonymous) return signedOut(request, env, user);
  return user;
}

function isResponse(value: ZoUser | Response): value is Response {
  return value instanceof Response;
}

export async function handleSaveCollection(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const db = d1(env);
  if (!db) return json({ error: 'Saves are unavailable' }, 503);

  if (request.method === 'GET') return listSaves(request, db, user.id);
  if (request.method === 'POST') return createSave(request, db, user.id);
  return json({ error: 'Method not allowed' }, 405);
}

export async function handleSaveItem(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const db = d1(env);
  if (!db) return json({ error: 'Saves are unavailable' }, 503);
  if (!id) return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') return getSave(db, user.id, id);
  if (request.method === 'DELETE') return deleteSave(db, user.id, id);
  return json({ error: 'Method not allowed' }, 405);
}

async function createSave(request: Request, db: D1Database, userId: string): Promise<Response> {
  let body: { query?: unknown; title?: unknown; card?: unknown };
  try {
    body = (await request.json()) as { query?: unknown; title?: unknown; card?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!query || typeof body.title !== 'string' || body.card === undefined) return json({ error: 'Invalid save' }, 400);
  let cardJson = '';
  try {
    if (cardBytes(body.card) > CARD_MAX) return json({ error: 'Card is too large' }, 413);
    cardJson = JSON.stringify(body.card);
  } catch {
    return json({ error: 'Invalid save' }, 400);
  }
  const hash = await sha256Hex(query);
  const id = randomId();
  const createdAt = new Date().toISOString();
  try {
    const row = await db
      .prepare(
        `INSERT INTO saved_items (id, user_id, query, query_hash, card_json, title, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, query_hash) DO UPDATE SET user_id = saved_items.user_id
         RETURNING id, created_at`,
      )
      .bind(id, userId, query, hash, cardJson, title, createdAt)
      .first<{ id: string; created_at: string }>();
    if (!row?.id) return json({ error: 'Something went wrong. Please try again.' }, 500);
    return json({ id: row.id, created_at: row.created_at }, row.id === id ? 201 : 200);
  } catch (err) {
    console.error('save failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function listSaves(request: Request, db: D1Database, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 50;
  const before = url.searchParams.get('before') || null;
  try {
    const result = await db
      .prepare(
        `SELECT id, query, title, created_at FROM saved_items
         WHERE user_id = ?1 AND (?2 IS NULL OR created_at < ?2)
         ORDER BY created_at DESC
         LIMIT ?3`,
      )
      .bind(userId, before, limit + 1)
      .all<SaveRow>();
    const rows = result.results;
    const more = rows.length > limit;
    const items = (more ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      query: row.query,
      title: row.title,
      created_at: row.created_at,
    }));
    const next = more ? items[items.length - 1]?.created_at ?? null : null;
    return json({ items, next });
  } catch (err) {
    console.error('save list failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function getSave(db: D1Database, userId: string, id: string): Promise<Response> {
  try {
    const row = await db
      .prepare(`SELECT id, query, title, card_json, created_at FROM saved_items WHERE id = ?1 AND user_id = ?2`)
      .bind(id, userId)
      .first<SaveRow>();
    if (!row) return json({ error: 'Not found' }, 404);
    let card: unknown = null;
    try {
      card = JSON.parse(row.card_json || 'null');
    } catch {
      card = null;
    }
    return json({ id: row.id, query: row.query, title: row.title, card, created_at: row.created_at });
  } catch (err) {
    console.error('save get failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function deleteSave(db: D1Database, userId: string, id: string): Promise<Response> {
  try {
    const result = await db.prepare(`DELETE FROM saved_items WHERE id = ?1 AND user_id = ?2`).bind(id, userId).run();
    if (!result.meta || result.meta.changes < 1) return json({ error: 'Not found' }, 404);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('save delete failed', err instanceof Error ? err.name : 'error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
