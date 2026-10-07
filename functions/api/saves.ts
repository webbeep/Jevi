import { handleSaveCollection } from '../../server/auth/saves';
import type { Env } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleSaveCollection(request, env);
export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleSaveCollection(request, env);
