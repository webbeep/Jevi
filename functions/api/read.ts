import { read } from '../../server/ai';
import { bindAiWaitUntil } from '../../server/aiBudget';
import { isFetchable } from '../../server/pages';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  bindAiWaitUntil(env, waitUntil);
  try {
    const { url, query, content, textOnly } = await readJson<{ url: string; query: string; content?: string; textOnly?: boolean }>(request);
    if (typeof url !== 'string' || !isFetchable(url)) return errorJson('Invalid url', 400);
    const known = typeof content === 'string' ? content.slice(0, 12000) : undefined;
    return json(await read(url, typeof query === 'string' ? query.slice(0, 300) : '', env, known, textOnly === true));
  } catch (err) {
    return errorJson(err);
  }
};
