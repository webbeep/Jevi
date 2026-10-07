import { me } from '../../../server/auth/facade';
import type { Env } from '../../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => me(request, env);
