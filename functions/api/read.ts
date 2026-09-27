import { read } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { url, query, content, textOnly } = await readJson<{ url: string; query: string; content?: string; textOnly?: boolean }>(request);
    if (!/^https?:\/\//.test(url)) return errorJson('Invalid url', 400);
    return json(await read(url, query ?? '', env, content, textOnly === true));
  } catch (err) {
    return errorJson(err);
  }
};
