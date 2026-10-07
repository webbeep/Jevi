import { slot } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { query, text } = await readJson<{ query: string; text: string }>(request);
    if (typeof text !== 'string' || !text.trim()) return errorJson('Missing text', 400);
    return json(await slot(typeof query === 'string' ? query.slice(0, 300) : '', text.slice(0, 2000), env));
  } catch (err) {
    return errorJson(err);
  }
};
