import { createAuth } from '../../../server/auth/better';
import { authEnabled, d1, sessionSecret } from '../../../server/auth/env';
import { errorJson, json, type Env } from '../../../server/util';

/** Better Auth catch-all: Google callback, anonymous sign-in, and the rest of its router. */
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!authEnabled(env)) return json({ error: 'Sign-in is disabled' }, 404);
  if (!d1(env) || !sessionSecret(env)) return json({ error: 'Sign-in is unavailable' }, 503);
  try {
    return await createAuth(env, request).handler(request);
  } catch (err) {
    return errorJson(err);
  }
};
