import { boundAsk } from '../../shared/queryBound';
import { planLayout } from '../../server/plan';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, original, cards, context } = await readJson<{ query: string; original?: string; cards?: { id: number; title: string }[]; context?: string }>(request);
    if (!query?.trim()) return errorJson('Missing query', 400);
    const asked = boundAsk(query);
    if (!asked) return errorJson('Missing query', 400);
    const earlier = original ? boundAsk(original) : '';
    return json(await planLayout(asked, env, { original: earlier || undefined, cards: Array.isArray(cards) ? cards : [], context: (context ?? '').slice(0, 2500) }));
  } catch (err) {
    return errorJson(err);
  }
};
