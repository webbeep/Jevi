import { layoutFromQuery } from '../../server/compose';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query } = await readJson<{ query: string }>(request);
    if (!query?.trim()) return errorJson('Missing query', 400);
    return json(await layoutFromQuery(query.trim(), env));
  } catch (err) {
    return errorJson(err);
  }
};
