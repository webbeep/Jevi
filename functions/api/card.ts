import { type DesignRequest, designCard } from '../../server/card';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await readJson<DesignRequest>(request);
    if (!body.query?.trim() || !body.search) return errorJson('Missing query or search', 400);
    return json(await designCard({ ...body, query: body.query.trim() }, env));
  } catch (err) {
    return errorJson(err);
  }
};
