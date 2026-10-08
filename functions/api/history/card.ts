import { handleHistoryCard } from '../../../server/auth/history';
import type { Env } from '../../../server/util';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleHistoryCard(request, env);
