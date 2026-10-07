import { handleSaveItem } from '../../../server/auth/saves';
import type { Env } from '../../../server/util';

function saveId(params: Record<string, string | string[]>): string {
  const raw = params.id;
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

export const onRequestGet: PagesFunction<Env> = ({ request, env, params }) => handleSaveItem(request, env, saveId(params));
export const onRequestDelete: PagesFunction<Env> = ({ request, env, params }) => handleSaveItem(request, env, saveId(params));
