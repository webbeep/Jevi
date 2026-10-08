export type DegradedReason = 'no_sources' | 'wiki_only' | 'provider_error' | 'no_fresh';

const REASONS: readonly DegradedReason[] = ['no_sources', 'wiki_only', 'provider_error', 'no_fresh'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asReason(value: unknown): DegradedReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value) ? (value as DegradedReason) : 'no_fresh';
}

/** Server flag on this object, with its degradedReason when it is one of the four. */
function flagged(value: unknown): DegradedReason | null {
  if (!isRecord(value) || value.degraded !== true) return null;
  return asReason(value.degradedReason);
}

/** Rules a–c. The wiki/empty heuristic is search-only and applied separately. */
function flaggedOrFailed(turn: Record<string, unknown>): DegradedReason | null {
  const flaggedReason = flagged(turn.result) ?? flagged(turn.search) ?? flagged(turn);
  if (flaggedReason) return flaggedReason;

  if (isRecord(turn.notice) && turn.notice.kind === 'no-sources') {
    return turn.notice.reason === 'unavailable' ? 'provider_error' : 'no_fresh';
  }

  if (isRecord(turn.result) && turn.result.engine === 'extractive') return 'provider_error';
  if (typeof turn.error === 'string' && turn.error) return 'provider_error';
  return null;
}

function wikiHost(result: unknown): boolean {
  if (!isRecord(result)) return false;
  let host = '';
  if (typeof result.domain === 'string' && result.domain) host = result.domain;
  else if (typeof result.url === 'string') {
    try {
      host = new URL(result.url).hostname;
    } catch {
      return false;
    }
  }
  host = host.toLowerCase();
  return host === 'wikipedia.org' || host.endsWith('.wikipedia.org');
}

/** Reason a single turn-like object is degraded, else null. */
export function turnDegraded(turn: unknown): DegradedReason | null {
  if (!isRecord(turn)) return null;

  const early = flaggedOrFailed(turn);
  if (early) return early;

  if (turn.kind === 'search' && turn.result != null && isRecord(turn.search) && Array.isArray(turn.search.results)) {
    const results = turn.search.results;
    if (results.length === 0) return 'no_sources';
    if (results.every(wikiHost)) return 'wiki_only';
  }

  return null;
}

/** First degraded search turn in a list of turn-like objects (snapshot), else null. Non-arrays -> null. */
export function turnsDegraded(turns: unknown): DegradedReason | null {
  if (!Array.isArray(turns)) return null;
  for (const turn of turns) {
    if (!isRecord(turn)) continue;
    // Search turns use every rule. Any other turn still counts for the server flag, notice, and provider error.
    const reason = turn.kind === 'search' ? turnDegraded(turn) : flaggedOrFailed(turn);
    if (reason) return reason;
  }
  return null;
}
