import { onetap } from '../../../server/auth/facade';
import type { Env } from '../../../server/util';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => onetap(request, env);
