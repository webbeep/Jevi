import type { SearchResponse } from '../../shared/types';
import { compose } from '../../server/compose';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return json(await compose(await readJson<SearchResponse>(request), env));
  } catch (err) {
    return errorJson(err);
  }
};
