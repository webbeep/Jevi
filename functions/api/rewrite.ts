import { rewriteQuery } from '../../server/ai';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { original, question } = await readJson<{ original: string; question: string }>(request);
    if (!question?.trim()) return errorJson('Missing question', 400);
    return json({ query: await rewriteQuery(original ?? '', question.trim(), env) });
  } catch (err) {
    return errorJson(err);
  }
};
