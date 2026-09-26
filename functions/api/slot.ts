import { slot } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, text } = await readJson<{ query: string; text: string }>(request);
    return json(await slot(query, text, env));
  } catch (err) {
    return errorJson(err);
  }
};
