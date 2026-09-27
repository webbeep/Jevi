import { planLayout } from '../../server/plan';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, original, cards } = await readJson<{ query: string; original?: string; cards?: { id: number; title: string }[] }>(request);
    if (!query?.trim()) return errorJson('Missing query', 400);
    return json(await planLayout(query.trim().slice(0, 300), env, original?.trim().slice(0, 300) || undefined, Array.isArray(cards) ? cards : []));
  } catch (err) {
    return errorJson(err);
  }
};
