import { logout } from '../../../server/auth/facade';
import type { Env } from '../../../server/util';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => logout(request, env);
