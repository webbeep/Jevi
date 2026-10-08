import type { SearchResponse } from '../shared/types';

/**
 * Ricky t432 / QA e9d2510(d): users never see model, engine or provider names. The client payload keeps
 * counts and the answer kind (`done.engine`: composed | reasoning | extractive, which drives the T424
 * degraded check), but provider names become 'web' and `via` (the model) stays in server logs only.
 */
export function publicSearch(res: SearchResponse): SearchResponse {
  return {
    ...res,
    results: res.results.map((r) => ({ ...r, engines: r.engines.map(() => 'web') })),
    engines: res.engines.map((e) => ({ ...e, name: 'web' as typeof e.name })),
  };
}

/** Strips provider/model names from one stream event; returns the model name (`via`) for the server log. */
export function publicEvent(event: string, data: unknown): { data: unknown; via?: string } {
  if (event === 'search' && data && typeof data === 'object' && Array.isArray((data as SearchResponse).results)) return { data: publicSearch(data as SearchResponse) };
  // The plan's router name ('jev' = the model family) is server-only; the client never reads it.
  if (event === 'plan' && data && typeof data === 'object' && 'engine' in data) {
    const { engine: _engine, ...rest } = data as { engine?: unknown };
    return { data: rest };
  }
  if (event === 'done' && data && typeof data === 'object' && 'via' in data) {
    const { via, ...rest } = data as { via?: unknown };
    return { data: rest, via: typeof via === 'string' ? via : undefined };
  }
  return { data };
}
