import { recordEvent } from '../../server/auth/events';
import type { Env } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => recordEvent(request, env);
