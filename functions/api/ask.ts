import type { AskRequest } from '../../shared/types';
import { ask } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return json(await ask(await readJson<AskRequest>(request), env));
  } catch (err) {
    return errorJson(err);
  }
};
