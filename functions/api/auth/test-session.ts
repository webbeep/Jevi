import { handleTestSession } from '../../../server/auth/testSession';
import type { Env } from '../../../server/util';

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleTestSession(request, env);
