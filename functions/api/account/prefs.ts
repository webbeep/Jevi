import { handlePrefs } from '../../../server/auth/prefs';
import type { Env } from '../../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handlePrefs(request, env);
export const onRequestPut: PagesFunction<Env> = ({ request, env }) => handlePrefs(request, env);
