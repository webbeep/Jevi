import type { GenerateRequest } from '../../shared/types';
import { generate } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return json(await generate(await readJson<GenerateRequest>(request), env));
  } catch (err) {
    return errorJson(err);
  }
};
