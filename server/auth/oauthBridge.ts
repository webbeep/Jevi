import { bytesToB64url } from './crypto.ts';
import { readCookie } from './device.ts';
import { currentUser } from './session.ts';
import { json, type Env } from '../util.ts';

/**
 * Google's OAuth client already allows https://zo2.pages.dev/api/auth/callback/google
 * and rejects https://zo.fyi/api/auth/callback/google (redirect_uri_mismatch, confirmed
 * 2026-10-11). The session cookie is host-only, so sign-in on the public host starts
 * on the allowed host and a one-time code carries the signed cookie back to zo.fyi.
 */
export const OAUTH_ORIGIN = 'https://zo2.pages.dev';
export const OAUTH_HOST = 'zo2.pages.dev';
export const CANONICAL_ORIGIN = 'https://zo.fyi';
export const CANONICAL_HOST = 'zo.fyi';

const BRIDGE_TTL_SEC = 60;
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const SESSION_COOKIE = '__Secure-zo_sess';
const PASS = new Set(['return', 'return_to', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);

export function isPublicHost(host: string): boolean {
  return host === CANONICAL_HOST || host === 'www.zo.fyi';
}

/** Same rule as safeReturnPath. Kept here so the bridge does not import the sign-in facade. */
export function bridgeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) return '/';
  return value;
}

/** Where a zo.fyi / www.zo.fyi sign-in navigation goes before Google. */
export function oauthBridgeStart(url: URL): string {
  const next = new URL('/api/auth/start', OAUTH_ORIGIN);
  for (const [key, value] of url.searchParams) {
    if (PASS.has(key)) next.searchParams.append(key, value);
  }
  next.searchParams.set('bridge', '1');
  return next.toString();
}

export function bridgeCallbackUrls(returnPath: string | null): { callbackURL: string; newUserCallbackURL: string; errorCallbackURL: string } {
  const path = encodeURIComponent(bridgeReturnPath(returnPath));
  return {
    callbackURL: `/api/auth/finish?return=${path}&auth=ok`,
    newUserCallbackURL: `/api/auth/finish?return=${path}&auth=ok&new_user=1`,
    errorCallbackURL: `/api/auth/finish?return=${path}&auth=error`,
  };
}

function withQuery(path: string, extra: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const joiner = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${joiner}${extra}${hash}`;
}

function statusQuery(url: URL, status: 'ok' | 'error'): string {
  const q = new URLSearchParams();
  q.set('auth', status);
  if (status === 'ok' && url.searchParams.get('new_user') === '1') q.set('new_user', '1');
  if (status === 'error') {
    const err = url.searchParams.get('error');
    if (err) q.set('error', err.slice(0, 64));
  }
  return q.toString();
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, 'referrer-policy': 'no-referrer' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function canonical(path: string, query: string): string {
  return `${CANONICAL_ORIGIN}${withQuery(path, query)}`;
}

function readSessionCookie(header: string | null): string | null {
  for (const name of [SESSION_COOKIE, 'zo_sess']) {
    try {
      const value = readCookie(header, name);
      if (value) return value;
    } catch {
      return null;
    }
  }
  return null;
}

function usableSession(raw: string): boolean {
  return raw.length > 20 && raw.length < 2000 && !/[\s;,]/.test(raw);
}

function randomCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

/** Google has finished on zo2.pages.dev. Mint a one-time code and send the browser to zo.fyi. */
export async function finish(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== OAUTH_HOST) return json({ error: 'Not found' }, 404);
  const ret = bridgeReturnPath(url.searchParams.get('return'));
  const failed = url.searchParams.get('auth') === 'error';
  const user = failed ? null : await currentUser(request, env);
  if (!user || user.anonymous) return redirect(canonical(ret, statusQuery(url, 'error')));
  const raw = readSessionCookie(request.headers.get('cookie'));
  const kv = env.ENGINE_SKIP;
  if (!raw || !usableSession(raw) || !kv) return redirect(`${OAUTH_ORIGIN}${withQuery(ret, statusQuery(url, 'ok'))}`);
  const code = randomCode();
  try {
    await kv.put(`oauth-bridge:${code}`, raw, { expirationTtl: BRIDGE_TTL_SEC });
  } catch {
    return redirect(`${OAUTH_ORIGIN}${withQuery(ret, statusQuery(url, 'ok'))}`);
  }
  const claim = new URL('/api/auth/claim', CANONICAL_ORIGIN);
  claim.searchParams.set('code', code);
  claim.searchParams.set('return', ret);
  if (url.searchParams.get('new_user') === '1') claim.searchParams.set('new_user', '1');
  return redirect(claim.toString());
}

/** zo.fyi trades the one-time code for the session cookie, then returns to the page. */
export async function claim(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.host === 'www.zo.fyi') {
    const next = new URL(url.pathname + url.search, CANONICAL_ORIGIN);
    return redirect(next.toString());
  }
  if (url.host !== CANONICAL_HOST) return json({ error: 'Not found' }, 404);
  const ret = bridgeReturnPath(url.searchParams.get('return'));
  const code = url.searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(code)) return redirect(canonical(ret, statusQuery(url, 'error')));
  const kv = env.ENGINE_SKIP;
  const key = `oauth-bridge:${code}`;
  let raw: string | null = null;
  try {
    raw = kv ? await kv.get(key) : null;
    if (kv) await kv.delete(key);
  } catch {
    raw = null;
  }
  if (!raw || !usableSession(raw)) return redirect(canonical(ret, statusQuery(url, 'error')));
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(raw)}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
  return redirect(canonical(ret, statusQuery(url, 'ok')), cookie);
}
