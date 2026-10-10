import { handleHistoryDelete, handleHistoryList } from '../../server/auth/history';
import type { Env } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => handleHistoryList(request, env);

export const onRequestDelete: PagesFunction<Env> = ({ request, env }) => handleHistoryDelete(request, env);
