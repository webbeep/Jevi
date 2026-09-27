import { planLayout } from '../../server/plan';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, original, cards, context } = await readJson<{ query: string; original?: string; cards?: { id: number; title: string }[]; context?: string }>(request);
    if (!query?.trim()) return errorJson('Missing query', 400);
    return json(await planLayout(query.trim().slice(0, 300), env, original?.trim().slice(0, 300) || undefined, Array.isArray(cards) ? cards : [], (context ?? '').slice(0, 1500)));
  } catch (err) {
    return errorJson(err);
  }
};
