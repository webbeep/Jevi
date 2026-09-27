import { sseResponse } from '../../server/sse';
import { type StreamRequest, runStream } from '../../server/stream';
import { Env, errorJson, readJson } from '../../server/util';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: StreamRequest;
  try {
    body = await readJson<StreamRequest>(request);
  } catch (err) {
    return errorJson(err, 400);
  }
  if (body.kind === 'search' && !body.query?.trim()) return errorJson('Missing query', 400);
  if (body.kind === 'search') body.query = body.query.trim().slice(0, 300);
  return sseResponse((send) => runStream(body, env, send));
};
