import type { Env } from '../util.ts';
import { hmacKey, hmacVerifyB64 } from './crypto.ts';
import { readCookie } from './device.ts';
import { d1, sessionSecret } from './env.ts';

export type ZoUser = { id: string; email: string; name: string; avatar: string | null; anonymous: boolean };

const SESSION_NAMES = ['zo_sess', '__Secure-zo_sess'];

/**
 * Better Auth signs `zo_sess` as `${token}.${base64-hmac}` (44-char padded signature).
 * Returns the raw session token, or null when the cookie is missing or the signature does not match.
 */
export async function sessionToken(cookieHeader: string | null, secret: string): Promise<string | null> {
  let raw: string | null = null;
  for (const name of SESSION_NAMES) {
    raw = readCookie(cookieHeader, name);
    if (raw) break;
  }
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const token = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!token || sig.length !== 44 || !sig.endsWith('=')) return null;
  return (await hmacVerifyB64(secret, token, sig)) ? token : null;
}

/** Sign a session token the same way Better Auth's setSignedCookie does. Tests and local fixtures only. */
export async function signSessionToken(token: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(token));
  let s = '';
  for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  return `${token}.${btoa(s)}`;
}

type SessionRow = { id: string; email: string; name: string; image: string | null; isAnonymous: number | boolean | null };

/**
 * Signed-in user from the zo_sess cookie: one HMAC verify and one session-row read.
 * Does not construct Better Auth. Anonymous sessions are returned with anonymous:true
 * so the gate can keep counting them as logged out.
 */
export async function currentUser(request: Request, env: Env, now = new Date()): Promise<ZoUser | null> {
  const secret = sessionSecret(env);
  const db = d1(env);
  if (!secret || !db) return null;
  const cookie = request.headers.get('cookie');
  if (!cookie || !cookie.includes('zo_sess=')) return null;
  try {
    const token = await sessionToken(cookie, secret);
    if (!token) return null;
    const row = await db
      .prepare(
        `SELECT u.id AS id, u.email AS email, u.name AS name, u.image AS image, u.isAnonymous AS isAnonymous
         FROM session s
         INNER JOIN user u ON u.id = s.userId
         WHERE s.token = ?1 AND s.expiresAt > ?2
         LIMIT 1`,
      )
      .bind(token, now.toISOString())
      .first<SessionRow>();
    if (!row?.id) return null;
    const anonymous = row.isAnonymous === true || row.isAnonymous === 1;
    return { id: row.id, email: row.email ?? '', name: row.name ?? '', avatar: row.image ?? null, anonymous };
  } catch {
    return null;
  }
}
