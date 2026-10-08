import { applyGate } from '../../server/auth/gate';
import type { Freshness, SearchResponse } from '../../shared/types';
import { bindAiWaitUntil } from '../../server/aiBudget';
import { serveStream } from '../../server/answerCache';
import { type StreamRequest, runStream } from '../../server/stream';
import { Env, errorJson, json, readJson } from '../../server/util';

const FRESHNESS = new Set<Freshness>(['any', 'day', 'week', 'month', 'year']);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Search results sent back by the client: bounded, so prompts and page reads stay within budget. */
function clampSearch(s: SearchResponse | undefined): SearchResponse | undefined {
  if (!s || !Array.isArray(s.results)) return undefined;
  return {
    ...s,
    results: s.results.slice(0, 20).map((r) => ({ ...r, title: text(r.title, 300), snippet: text(r.snippet, 1000), content: r.content ? text(r.content, 6000) : undefined })),
    images: Array.isArray(s.images) ? s.images.slice(0, 24) : [],
    discussions: Array.isArray(s.discussions) ? s.discussions.slice(0, 8) : [],
    engines: Array.isArray(s.engines) ? s.engines.slice(0, 16) : [],
  };
}

/** Validates and bounds the request; returns undefined when it can't be served. */
function clean(body: StreamRequest | null): StreamRequest | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const context = text(body.context, 6000) || undefined;
  switch (body.kind) {
    case 'search': {
      const query = text(body.query, 300);
      return query ? { kind: 'search', query, freshness: FRESHNESS.has(body.freshness) ? body.freshness : 'any', context } : undefined;
    }
    case 'design': {
      const search = clampSearch(body.search);
      const query = text(body.query, 300);
      return search && query ? { ...body, query, search, context } : undefined;
    }
    case 'followup': {
      const search = clampSearch(body.search);
      const question = text(body.question, 600);
      const cards = Array.isArray(body.cards) ? body.cards.slice(-8).map((c) => ({ ...c, title: text(c.title, 120) })) : [];
      return search && question ? { ...body, question, original: text(body.original, 300), search, cards, context } : undefined;
    }
    default: {
      const unknown: never = body;
      return unknown;
    }
  }
}

function stamp(res: Response, headers?: Record<string, string>): Response {
  if (!headers) return res;
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const gate = await applyGate(request, env);
  if (!gate.ok) return json(gate.body, 401);
  let body: StreamRequest | undefined;
  try {
    body = clean(await readJson<StreamRequest>(request));
  } catch (err) {
    return stamp(errorJson(err, 400), gate.headers);
  }
  if (!body) return stamp(errorJson('Invalid request', 400), gate.headers);
  const req = body;
  bindAiWaitUntil(env, waitUntil);
  return stamp(await serveStream({ request, env, req, run: (send) => runStream(req, env, send, { request, waitUntil: (p) => waitUntil(p) }), waitUntil }), gate.headers);
};
