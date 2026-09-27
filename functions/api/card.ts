import type { LayoutPlan } from '../../shared/card';
import type { SearchResponse } from '../../shared/types';
import { designCard } from '../../server/card';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await readJson<{ query: string; pattern: string; depth: LayoutPlan['depth']; readPages?: boolean; search: SearchResponse; simple?: boolean }>(request);
    if (!body.query?.trim() || !body.search) return errorJson('Missing query or search', 400);
    return json(await designCard({ ...body, query: body.query.trim() }, env));
  } catch (err) {
    return errorJson(err);
  }
};
