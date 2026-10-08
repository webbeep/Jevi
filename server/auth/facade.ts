import type { Env } from '../util.ts';
import { json } from '../util.ts';
import { createAuth } from './better.ts';
import { authEnabled, d1, sessionSecret } from './env.ts';
import { readFacingUsage } from './gate.ts';
import { currentUser, deleteSession } from './session.ts';

function originOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Same-origin path only. Rejects protocol-relative and backslash tricks. */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) return '/';
  return value;
}

/** `return` wins when both are present. Missing both is null (caller applies safeReturnPath). */
export function returnTarget(url: URL): string | null {
  return url.searchParams.get('return') ?? url.searchParams.get('return_to');
}

function appendQuery(path: string, extra: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const joiner = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${joiner}${extra}${hash}`;
}

export type SignInCallbackUrls = {
  callbackURL: string;
  newUserCallbackURL: string;
  errorCallbackURL: string;
};

/**
 * Paths passed to Better Auth signIn.social. Existing query is kept.
 * Better Auth appends `error=<code>` onto errorCallbackURL (`access_denied` = cancelled).
 */
export function signInCallbackUrls(returnPath: string | null): SignInCallbackUrls {
  const path = safeReturnPath(returnPath);
  return {
    callbackURL: appendQuery(path, 'auth=ok'),
    newUserCallbackURL: appendQuery(path, 'auth=ok&new_user=1'),
    errorCallbackURL: appendQuery(path, 'auth=error'),
  };
}

function utmValue(url: URL): string | null {
  const parts = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    .map((k) => url.searchParams.get(k)?.trim())
    .filter((v): v is string => !!v && v.length < 80);
  if (!parts.length) return null;
  return parts.join('|').slice(0, 180);
}

function cookieAttrs(request: Request, maxAge: number): string {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const secure = proto === 'https' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function appendCookies(out: Headers, from: Headers) {
  const list = typeof from.getSetCookie === 'function' ? from.getSetCookie() : [];
  for (const c of list) out.append('set-cookie', c);
  if (!list.length) {
    const one = from.get('set-cookie');
    if (one) out.append('set-cookie', one);
  }
}

export async function me(request: Request, env: Env): Promise<Response> {
  const enabled = authEnabled(env);
  const user = await currentUser(request, env);
  const signed = user && !user.anonymous ? user : null;
  const usage = await readFacingUsage(request, env, user);
  return json({
    auth_enabled: enabled,
    user: signed ? { id: signed.id, email: signed.email, name: signed.name, avatar: signed.avatar } : null,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    signedIn: usage.signedIn,
    day: usage.day,
  });
}

export async function start(request: Request, env: Env): Promise<Response> {
  if (!authEnabled(env)) return json({ error: 'Sign-in is disabled' }, 404);
  if (!d1(env) || !sessionSecret(env)) return json({ error: 'Sign-in is unavailable' }, 503);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'Sign-in is unavailable' }, 503);
  const url = new URL(request.url);
  const callbacks = signInCallbackUrls(returnTarget(url));
  const origin = originOf(request);
  const auth = await createAuth(env, request);
  const ba = await auth.handler(
    new Request(new URL('/api/auth/sign-in/social', url.origin), {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') || '', 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: `${origin}${callbacks.callbackURL}`,
        newUserCallbackURL: `${origin}${callbacks.newUserCallbackURL}`,
        errorCallbackURL: `${origin}${callbacks.errorCallbackURL}`,
      }),
    }),
  );
  const loc = ba.headers.get('location') || ((await ba.clone().json().catch(() => null)) as { url?: string } | null)?.url;
  if (!loc || !loc.startsWith('https://accounts.google.com/')) {
    return json({ error: 'Could not start sign-in' }, 502);
  }
  const headers = new Headers({ location: loc });
  appendCookies(headers, ba.headers);
  const utm = utmValue(url);
  if (utm) headers.append('set-cookie', `zo_utm=${encodeURIComponent(utm)}; ${cookieAttrs(request, 600)}`);
  return new Response(null, { status: 302, headers });
}

export async function onetap(request: Request, env: Env): Promise<Response> {
  if (!authEnabled(env)) return json({ error: 'Sign-in is disabled' }, 404);
  if (!d1(env) || !sessionSecret(env) || !env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in is unavailable' }, 503);
  let credential = '';
  try {
    const body = (await request.json()) as { credential?: unknown };
    credential = typeof body.credential === 'string' ? body.credential : '';
  } catch {
    return json({ error: 'bad token' }, 400);
  }
  if (!credential) return json({ error: 'bad token' }, 400);
  const url = new URL(request.url);
  const auth = await createAuth(env, request);
  const ba = await auth.handler(
    new Request(new URL('/api/auth/one-tap/callback', url.origin), {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') || '', 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ idToken: credential }),
    }),
  );
  if (!ba.ok) return json({ error: 'bad token' }, 400);
  const data = (await ba.json().catch(() => null)) as { user?: { id: string; email: string; name: string; image?: string | null } } | null;
  if (!data?.user?.id) return json({ error: 'bad token' }, 400);
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  appendCookies(headers, ba.headers);
  const user = { id: data.user.id, email: data.user.email, name: data.user.name, avatar: data.user.image ?? null };
  return new Response(JSON.stringify({ user }), { status: 200, headers });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const headers = new Headers();
  try {
    await deleteSession(request, env);
  } catch {
    /* still clear the cookie below */
  }
  if (d1(env) && sessionSecret(env)) {
    try {
      const url = new URL(request.url);
      const auth = await createAuth(env, request);
      const ba = await auth.handler(
        new Request(new URL('/api/auth/sign-out', url.origin), {
          method: 'POST',
          headers: { cookie: request.headers.get('cookie') || '', origin: url.origin },
        }),
      );
      appendCookies(headers, ba.headers);
    } catch {
      /* still clear the cookie below */
    }
  }
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const secure = proto === 'https' ? '; Secure' : '';
  headers.append('set-cookie', `zo_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  return new Response(null, { status: 204, headers });
}
