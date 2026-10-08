export type DegradedReason = 'no_sources' | 'wiki_only' | 'provider_error' | 'no_fresh';
import type { SearchResponse } from '../shared/types';

const KEYLESS = new Set(['wikipedia', 'backup']);

function wikiOnly(result: { url?: string; domain?: string; engines?: string[] }): boolean {
  if (Array.isArray(result.engines) && result.engines.length) return result.engines.every((e) => KEYLESS.has(e));
  const host = (result.domain || (() => { try { return new URL(result.url ?? '').hostname; } catch { return ''; } })()).toLowerCase();
  return host === 'wikipedia.org' || host.endsWith('.wikipedia.org');
}

/** Every keyed provider that ran failed (payment/quota/unavailable/…), not merely came back empty. */
export function keyedAllFailed(search: Pick<SearchResponse, 'engines'>): boolean {
  const keyed = (search.engines ?? []).filter((e) => !KEYLESS.has(e.name));
  return keyed.length > 0 && keyed.every((e) => !!e.error && e.error !== 'empty');
}

/**
 * T424 server classification. 0 sources → provider_error (every keyed provider failed),
 * no_fresh (answered from general knowledge), else no_sources. All-Wikipedia sources → wiki_only.
 */
export function searchDegraded(search: Pick<SearchResponse, 'results' | 'engines'>, opts?: { knowledge?: boolean }): DegradedReason | undefined {
  const results = search.results ?? [];
  if (!results.length) {
    if (keyedAllFailed(search)) return 'provider_error';
    return opts?.knowledge ? 'no_fresh' : 'no_sources';
  }
  if (results.every(wikiOnly)) return 'wiki_only';
  return undefined;
}

/** Copy with the contract fields set (degraded: true + degradedReason) or removed when healthy. */
export function stampDegraded<T extends object>(value: T, reason: DegradedReason | undefined): T {
  const { degraded: _d, degradedReason: _r, ...rest } = value as T & { degraded?: unknown; degradedReason?: unknown };
  return (reason ? { ...rest, degraded: true, degradedReason: reason } : rest) as T;
}

/** A saved AnswerCard with no citations at all (no citations node, no [n] marker) or an explicit flag. */
export function savedCardDegraded(card: unknown): DegradedReason | undefined {
  if (!card || typeof card !== 'object') return undefined;
  const flag = card as { degraded?: unknown; degradedReason?: unknown };
  if (flag.degraded === true) {
    const r = flag.degradedReason;
    return r === 'no_sources' || r === 'wiki_only' || r === 'provider_error' || r === 'no_fresh' ? r : 'no_fresh';
  }
  const text = JSON.stringify(card);
  if (/"type":"citations"/.test(text) || /\[\d+\]/.test(text)) return undefined;
  return 'no_sources';
}
