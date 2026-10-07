import type { Env } from '../util.ts';
import { createAuth } from './better.ts';
import { d1, sessionSecret } from './env.ts';

export type ZoUser = { id: string; email: string; name: string; avatar: string | null; anonymous: boolean };

/** Google (or other non-anonymous) session from the zo_sess cookie. Anonymous sessions count as logged out for the gate. */
export async function currentUser(request: Request, env: Env): Promise<ZoUser | null> {
  if (!d1(env) || !sessionSecret(env)) return null;
  const cookie = request.headers.get('cookie') || '';
  if (!cookie.includes('zo_sess=')) return null;
  try {
    const auth = createAuth(env, request);
    const session = await auth.api.getSession({ headers: request.headers });
    const user = session?.user as { id: string; email: string; name: string; image?: string | null; isAnonymous?: boolean | null } | undefined;
    if (!user?.id) return null;
    return { id: user.id, email: user.email, name: user.name, avatar: user.image ?? null, anonymous: Boolean(user.isAnonymous) };
  } catch {
    return null;
  }
}
