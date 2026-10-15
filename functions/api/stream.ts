import { boundAsk } from '../../shared/queryBound';
import { applyGate } from '../../server/auth/gate';
import { recordAsk } from '../../server/auth/history';
import { cleanRef } from '../../shared/askAbout';
import type { Freshness, SearchResponse } from '../../shared/types';
import { bindAiWaitUntil } from '../../server/aiBudget';
import { serveStream } from '../../server/answerCache';
import { queryWithPlace, readerPlace } from '../../server/readings';
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
      const query = boundAsk(typeof body.query === 'string' ? body.query : '');
      return query ? { kind: 'search', query, freshness: FRESHNESS.has(body.freshness) ? body.freshness : 'any', context } : undefined;
    }
    case 'design': {
      const search = clampSearch(body.search);
      const query = boundAsk(typeof body.query === 'string' ? body.query : '');
      return search && query ? { ...body, query, search, context } : undefined;
    }
    case 'followup': {
      const search = clampSearch(body.search);
      const question = boundAsk(typeof body.question === 'string' ? body.question : '');
      const cards = Array.isArray(body.cards) ? body.cards.slice(-8).map((c) => ({ ...c, title: text(c.title, 120) })) : [];
      const ref = cleanRef(body.ref);
      const original = boundAsk(typeof body.original === 'string' ? body.original : '');
      return search && question ? { ...body, question, original, search, cards, context, ...(ref ? { ref } : {}) } : undefined;
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

/** Question text the gate hashes. Follow-ups ask `question`; search and design ask `query`. */
function asked(body: StreamRequest | null): string {
  if (!body || typeof body !== 'object') return '';
  if (body.kind === 'followup') return typeof body.question === 'string' ? body.question : '';
  if (body.kind === 'search' || body.kind === 'design') return typeof body.query === 'string' ? body.query : '';
  return '';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let raw: StreamRequest | null = null;
  try {
    raw = await readJson<StreamRequest>(request);
  } catch (err) {
    const gate = await applyGate(request, env, new Date(), undefined, '');
    if (!gate.ok) return json(gate.body, 401);
    return stamp(errorJson(err, 400), gate.headers);
  }
  const gate = await applyGate(request, env, new Date(), undefined, asked(raw));
  if (!gate.ok) return json(gate.body, 401);
  const body = clean(raw);
  if (!body) return stamp(errorJson('Invalid request', 400), gate.headers);
  // T446: every signed-in search/follow-up goes into the account's ask history.
  if (gate.userId && (body.kind === 'search' || body.kind === 'followup')) {
    const q = body.kind === 'search' ? body.query : body.question;
    if (typeof q === 'string' && q.trim()) waitUntil(recordAsk(env, gate.userId, q, body.kind));
  }
  // A bare "weather" is cached and searched for the reader's city, so two cities never share an answer.
  const cf = (request as Request & { cf?: { city?: unknown; region?: unknown; regionCode?: unknown } }).cf;
  const req = body.kind === 'search' ? { ...body, query: queryWithPlace(body.query, readerPlace(cf)) } : body;
  const typed = body.kind === 'search' && req.kind === 'search' && req.query !== body.query ? body.query : undefined;
  bindAiWaitUntil(env, waitUntil);
  return stamp(await serveStream({ request, env, req, run: (send) => runStream(req, env, send, { request, signedIn: !!gate.userId, waitUntil: (p) => waitUntil(p), typed }), waitUntil }), gate.headers);
};
