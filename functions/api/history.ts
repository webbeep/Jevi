import { handleHistoryList } from '../../server/auth/history';
import type { Env } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleHistoryList(request, env);
