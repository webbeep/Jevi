import type { Env } from '../util.ts';
import { json } from '../util.ts';
import { authEnabled, d1 } from './env.ts';
import { readFacingUsage } from './gate.ts';
import { currentUser, type ZoUser } from './session.ts';

const BODY_MAX = 16 * 1024;
const HISTORY_MAX = 50;
const ITEM_MAX = 200;

type PrefsRow = { sync_history: number; history_json: string | null };

export type PrefsShape = { sync_history: boolean; history: string[] };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Trim, cap, drop blanks and non-strings, dedupe, keep the first 50. */
export function cleanHistory(items: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, ITEM_MAX);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= HISTORY_MAX) break;
  }
  return out;
}

function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? cleanHistory(parsed) : [];
  } catch {
    return [];
  }
}

function shape(sync: boolean, historyJson: string | null): PrefsShape {
  return { sync_history: sync, history: sync ? parseHistory(historyJson) : [] };
}

async function signedOut(request: Request, env: Env, user: ZoUser | null): Promise<Response> {
  const usage = await readFacingUsage(request, env, user && user.anonymous ? user : null);
  return json({ need_signin: true, used: usage.used, limit: usage.limit, remaining: usage.remaining, signedIn: false }, 401);
}

async function readRow(db: D1Database, userId: string): Promise<PrefsRow | null> {
  return db
    .prepare(`SELECT sync_history, history_json FROM user_prefs WHERE user_id = ?1`)
    .bind(userId)
    .first<PrefsRow>();
}

export async function handlePrefs(request: Request, env: Env): Promise<Response> {
  if (!authEnabled(env) || !d1(env)) return json({ error: 'Sign-in is disabled' }, 404);
  const user = await currentUser(request, env);
  if (!user || user.anonymous) return signedOut(request, env, user);
  const db = d1(env);
  if (!db) return json({ error: 'Sign-in is disabled' }, 404);
  if (request.method === 'GET') return getPrefs(db, user.id);
  if (request.method === 'PUT') return putPrefs(request, db, user.id);
  return json({ error: 'Method not allowed' }, 405);
}

async function getPrefs(db: D1Database, userId: string): Promise<Response> {
  const row = await readRow(db, userId);
  const on = Number(row?.sync_history) === 1;
  return json(shape(on, row?.history_json ?? null));
}

async function putPrefs(request: Request, db: D1Database, userId: string): Promise<Response> {
  const declared = Number(request.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > BODY_MAX) return json({ error: 'Body is too large' }, 413);
  const raw = await request.text();
  if (byteLength(raw) > BODY_MAX) return json({ error: 'Body is too large' }, 413);
  let body: { sync_history?: unknown; history?: unknown };
  try {
    body = JSON.parse(raw) as { sync_history?: unknown; history?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid prefs' }, 400);
  if (body.sync_history !== undefined && typeof body.sync_history !== 'boolean') return json({ error: 'Invalid prefs' }, 400);
  if (body.history !== undefined && !Array.isArray(body.history)) return json({ error: 'Invalid prefs' }, 400);

  const existing = await readRow(db, userId);
  const currentlyOn = Number(existing?.sync_history) === 1;
  const nextOn = body.sync_history === undefined ? currentlyOn : body.sync_history;
  let historyJson: string | null;
  if (!nextOn) historyJson = null;
  else if (Array.isArray(body.history)) historyJson = JSON.stringify(cleanHistory(body.history));
  else historyJson = existing?.history_json ?? '[]';

  await db
    .prepare(
      `INSERT INTO user_prefs (user_id, sync_history, history_json, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET
         sync_history = excluded.sync_history,
         history_json = excluded.history_json,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, nextOn ? 1 : 0, historyJson, Date.now())
    .run();
  return json(shape(nextOn, historyJson));
}
