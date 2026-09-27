import { planLayout } from '../../server/card';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query } = await readJson<{ query: string }>(request);
    if (!query?.trim()) return errorJson('Missing query', 400);
    return json(await planLayout(query.trim().slice(0, 300), env));
  } catch (err) {
    return errorJson(err);
  }
};
