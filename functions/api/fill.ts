import type { ComponentKind, SearchResponse } from '../../shared/types';
import { fillFromResults } from '../../server/compose';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, search, blocks } = await readJson<{ query: string; search: SearchResponse; blocks: ComponentKind[] }>(request);
    if (!query?.trim() || !search) return errorJson('Missing query or search', 400);
    return json(await fillFromResults(query.trim(), search, blocks ?? [], env));
  } catch (err) {
    return errorJson(err);
  }
};
