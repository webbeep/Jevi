import { handleHistoryItem } from '../../../server/auth/history';
import type { Env } from '../../../server/util';

function itemId(params: Record<string, string | string[]>): string {
  const raw = params.id;
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

export const onRequestGet: PagesFunction<Env> = ({ request, env, params }) => handleHistoryItem(request, env, itemId(params));
