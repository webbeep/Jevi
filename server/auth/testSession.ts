import type { Env } from '../util.ts';
import { json } from '../util.ts';
import { carryKey } from './carry.ts';
import { randomId } from './crypto.ts';
import { readCookie, verifyDevice } from './device.ts';
import { authEnabled, d1, sessionSecret } from './env.ts';
import { deleteSession, signSessionToken } from './session.ts';

const WEEK_SEC = 60 * 60 * 24 * 7;
const WEEK_MS = WEEK_SEC * 1000;

type Body = { email?: string; name?: string; carry: boolean };

function localHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** Host and ZO_TEST_SESSION only. Callers must not touch D1 before this is true. */
function testSessionArmed(request: Request, env: Env): boolean {
  let hostname = '';
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  return localHost(hostname) && env.ZO_TEST_SESSION === 'on';
}

function notFound(): Response {
  return json({ error: 'Not found' }, 404);
}

function httpsRequest(request: Request): boolean {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return proto === 'https';
}

function qaEmail(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `qa+${hex}@zo.local`;
}

async function readBody(request: Request): Promise<Body | Response> {
  let text = '';
  try {
    text = await request.text();
  } catch {
    return { carry: false };
  }
  if (!text.trim()) return { carry: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Invalid JSON body' }, 400);
  const raw = parsed as { email?: unknown; name?: unknown; carry?: unknown };
  const email = typeof raw.email === 'string' ? raw.email.trim().slice(0, 254) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  return { email: email || undefined, name: name || undefined, carry: raw.carry === true };
}

function isResponse(value: Body | Response): value is Response {
  return value instanceof Response;
}

async function sessionCookie(token: string, secret: string, request: Request): Promise<string> {
  const signed = await signSessionToken(token, secret);
  const https = httpsRequest(request);
  const name = https ? '__Secure-zo_sess' : 'zo_sess';
  const secure = https ? '; Secure' : '';
  return `${name}=${encodeURIComponent(signed)}; Path=/; Max-Age=${WEEK_SEC}; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookie(request: Request): string {
  const secure = httpsRequest(request) ? '; Secure' : '';
  const name = httpsRequest(request) ? '__Secure-zo_sess' : 'zo_sess';
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

async function carryDevice(db: D1Database, request: Request, secret: string, userId: string): Promise<void> {
  const raw = readCookie(request.headers.get('cookie'), 'zo_dev');
  if (!raw) return;
  const deviceId = await verifyDevice(raw, secret);
  if (!deviceId) return;
  await carryKey(db, `d:${deviceId}`, `u:${userId}`, false);
}

/**
 * Local-only session fixture. Host + ZO_TEST_SESSION are checked before AUTH_ENABLED, the secret, or D1.
 * x-zo-test-token is ignored: this route never treats that header as a session.
 */
export async function handleTestSession(request: Request, env: Env, now = new Date()): Promise<Response> {
  if (!testSessionArmed(request, env)) return notFound();
  if (!authEnabled(env)) return notFound();
  const secret = sessionSecret(env);
  if (!secret) return notFound();
  const db = d1(env);
  if (!db) return notFound();

  if (request.method === 'DELETE') {
    await deleteSession(request, env);
    return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(request) } });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(request);
  if (isResponse(body)) return body;

  const email = body.email || qaEmail();
  const name = body.name || 'QA Test';
  const stamp = now.toISOString();
  const existing = await db
    .prepare(`SELECT id, email, name FROM user WHERE email = ?1 LIMIT 1`)
    .bind(email)
    .first<{ id: string; email: string; name: string }>();

  let userId: string;
  let userEmail: string;
  let userName: string;
  if (existing?.id) {
    userId = existing.id;
    userEmail = existing.email;
    userName = existing.name;
    await db.prepare(`UPDATE user SET isAnonymous = 0, updatedAt = ?2 WHERE id = ?1`).bind(userId, stamp).run();
  } else {
    userId = randomId();
    userEmail = email;
    userName = name;
    await db
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, isAnonymous)
         VALUES (?1, ?2, ?3, 0, NULL, ?4, ?4, 0)`,
      )
      .bind(userId, userName, userEmail, stamp)
      .run();
  }

  const token = randomId();
  const expires = new Date(now.getTime() + WEEK_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?1, ?2, ?3, ?4, ?4, '', NULL, ?5)`,
    )
    .bind(randomId(), expires, token, stamp, userId)
    .run();

  if (body.carry) await carryDevice(db, request, secret, userId);

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', await sessionCookie(token, secret, request));
  return new Response(JSON.stringify({ user: { id: userId, email: userEmail, name: userName, avatar: null } }), { status: 200, headers });
}
