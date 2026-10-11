import { finish } from '../../../server/auth/oauthBridge';
import type { Env } from '../../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => finish(request, env);
