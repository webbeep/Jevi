import { ANSWER_TTL_S, answerCacheUrl } from '../shared/answerKey';
import { type Send, sseResponse } from './sse';
import type { StreamRequest } from './stream';
import { cacheBypass, testForce } from './token';
import type { Env } from './util';

export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

function defaultCache(): CacheLike | null {
  if (typeof caches === 'undefined' || !caches.default) return null;
  return caches.default;
}

const HIT_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  'X-ZO-Cache': 'HIT',
};

/**
 * Serves a search stream from the answer cache when the same query already finished.
 * Only `kind: 'search'` is cacheable. Hits replay the stored SSE bytes unchanged.
 */
export async function serveStream(o: {
  request: Request;
  env: Env;
  req: StreamRequest;
  run: (send: Send) => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
  cache?: CacheLike | null;
}): Promise<Response> {
  const cache = o.cache === undefined ? defaultCache() : o.cache;
  if (o.req.kind !== 'search') return sseResponse(o.run, { headers: { 'X-ZO-Cache': 'SKIP' } });
  if (!cache) return sseResponse(o.run);

  const key = new Request(answerCacheUrl({ query: o.req.query, freshness: o.req.freshness, context: o.req.context }));
  const bypass = cacheBypass(o.request, o.env);
  if (!bypass) {
    try {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: HIT_HEADERS });
    } catch {
      /* treat a broken cache as a miss */
    }
  }

  const frames: string[] = [];
  let sawDone = false;
  let sawError = false;
  let sawNode = false;
  let extractive = false;

  return sseResponse(
    async (send) => {
      const wrapped: Send = (event, data) => {
        if (event === 'done' && data !== null && typeof data === 'object' && (data as { engine?: unknown }).engine === 'extractive') extractive = true;
        // T424: never cache a degraded answer (no-sources notice, or a degraded search/done payload).
        if (event === 'notice' || ((event === 'search' || event === 'done') && data !== null && typeof data === 'object' && (data as { degraded?: unknown }).degraded === true)) extractive = true;
        // T444: a disambiguation turn has no card; never cache it.
        if (event === 'entity-choices') extractive = true;
        send(event, data);
      };
      await o.run(wrapped);
      if (o.request.headers.get('x-zo-retry') === '1') return;
      // Forced QA faults never write a cache.
      if (testForce(o.request, o.env)) return;
      const last = frames.at(-1);
      if (!sawDone || sawError || !sawNode || extractive || !last?.startsWith('event: done\n')) return;
      const put = cache
        .put(
          key,
          new Response(frames.join(''), {
            headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': `public, max-age=${ANSWER_TTL_S}` },
          }),
        )
        .catch(() => undefined);
      if (o.waitUntil) o.waitUntil(put);
    },
    {
      headers: { 'X-ZO-Cache': bypass ? 'BYPASS' : 'MISS' },
      onFrame: (event, frame) => {
        frames.push(frame);
        if (event === 'node') sawNode = true;
        else if (event === 'error') sawError = true;
        else if (event === 'done') sawDone = true;
      },
    },
  );
}
