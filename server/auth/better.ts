import { betterAuth } from 'better-auth';
import { anonymous, oneTap } from 'better-auth/plugins';
import type { Env } from '../util.ts';
import { carrySubject } from './carry.ts';
import { readCookie, verifyDevice } from './device.ts';
import { d1, sessionSecret } from './env.ts';

type Auth = ReturnType<typeof betterAuth>;
const cache = new Map<string, Auth>();

function utmFromRequest(request: Request | undefined): string | null {
  if (!request) return null;
  const raw = readCookie(request.headers.get('cookie'), 'zo_utm');
  if (!raw) return null;
  return raw.slice(0, 180);
}

/** Better Auth on the request's D1 binding. Cached per origin + secret inside the isolate. */
export function createAuth(env: Env, request: Request): Auth {
  const db = d1(env);
  const secret = sessionSecret(env);
  if (!db || !secret) throw new Error('auth is not configured');
  const url = new URL(request.url);
  const baseURL = `${url.protocol}//${url.host}`;
  const key = `${baseURL}\0${secret}\0${env.GOOGLE_CLIENT_ID || ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const https = url.protocol === 'https:';
  const auth = betterAuth({
    appName: 'zo',
    baseURL,
    secret,
    database: db,
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    user: {
      additionalFields: {
        srcUtm: { type: 'string', required: false, fieldName: 'src_utm' },
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || 'missing-client-id',
        clientSecret: env.GOOGLE_CLIENT_SECRET || 'missing-client-secret',
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const srcUtm = utmFromRequest(ctx?.request ?? undefined);
            if (!srcUtm) return;
            return { data: { ...user, srcUtm } };
          },
        },
      },
    },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          const req = ctx?.request;
          const token = req ? readCookie(req.headers.get('cookie'), 'zo_dev') : null;
          const deviceId = token ? await verifyDevice(token, secret) : null;
          await carrySubject(db, anonymousUser.user.id, newUser.user.id, deviceId);
        },
      }),
      oneTap(),
    ],
    advanced: {
      ipAddress: { disableIpTracking: true },
      cookies: { session_token: { name: 'zo_sess' } },
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: https },
    },
    trustedOrigins: [baseURL],
  }) as unknown as Auth;
  if (cache.size > 4) cache.clear();
  cache.set(key, auth);
  return auth;
}
