import { claim } from '../../../server/auth/oauthBridge';
import type { Env } from '../../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => claim(request, env);
