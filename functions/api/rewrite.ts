import { rewriteQuery } from '../../server/ai';
import { bindAiWaitUntil } from '../../server/aiBudget';
import { Env, errorJson, json, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  bindAiWaitUntil(env, waitUntil);
  try {
    const { original, question, context } = await readJson<{ original: string; question: string; context?: string }>(request);
    if (!question?.trim()) return errorJson('Missing question', 400);
    return json({ query: await rewriteQuery(original ?? '', question.trim(), env, (context ?? '').slice(0, 1500)) });
  } catch (err) {
    return errorJson(err);
  }
};
