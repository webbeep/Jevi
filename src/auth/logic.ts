/** Pure auth helpers. No DOM, so unit tests can import this file directly. */

export type AuthReturnStatus = 'ok' | 'cancelled' | 'error' | null;

export interface AuthReturn {
  status: AuthReturnStatus;
  isNew: boolean;
  errorCode: string | null;
  /** Query string without `?`. Auth params removed. */
  search: string;
  changed: boolean;
}

/**
 * Read `auth=ok` or `auth=error` (`error=access_denied` is a cancel) and `new_user=1`.
 * Strips those params and leaves the rest (including `q`).
 */
export function parseAuthReturn(search: string): AuthReturn {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const auth = params.get('auth');
  const code = params.get('error');
  let status: AuthReturnStatus = null;
  if (auth === 'ok') status = 'ok';
  else if (auth === 'cancelled') status = 'cancelled';
  else if (auth === 'error') status = code === 'access_denied' ? 'cancelled' : 'error';

  const isNew = params.get('new_user') === '1';
  const strip = auth != null || params.has('new_user');
  if (strip) {
    params.delete('auth');
    params.delete('new_user');
    if (auth != null) params.delete('error');
  }
  return {
    status,
    isNew,
    errorCode: status === 'cancelled' || status === 'error' ? code : null,
    search: params.toString(),
    changed: strip,
  };
}

export type GateRoute = 'sheet' | 'signed' | 'ip';

/** `device` (and a missing reason) opens the sign-in sheet. `signed` and `ip` stay inline. */
export function routeGate(reason: string): GateRoute {
  if (reason === 'ip') return 'ip';
  if (reason === 'signed') return 'signed';
  if (reason === 'device' || reason === '') return 'sheet';
  return 'signed';
}

export const HISTORY_CAP = 50;
export const HISTORY_MAX_CHARS = 200;

export function clipHistoryQuery(raw: string): string {
  return raw.trim().slice(0, HISTORY_MAX_CHARS);
}

/** Newest-first list, deduped case-insensitively, clipped, capped at 50. */
export function capHistory(items: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const q = clipHistoryQuery(raw);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= HISTORY_CAP) break;
  }
  return out;
}

export interface MergeRow {
  q: string;
  t: number;
}

/**
 * Union device history with a newest-first server list.
 * Device timestamps win on duplicates. Server-only rows are newer than `now` stepping backward.
 * Result is newest-first, capped at 50, each query clipped to 200 characters.
 */
export function mergeHistory(device: readonly MergeRow[], server: readonly string[], now = Date.now()): MergeRow[] {
  const rows: MergeRow[] = [];
  const seen = new Set<string>();
  for (const row of device) {
    if (!row || typeof row.q !== 'string' || typeof row.t !== 'number') continue;
    const q = clipHistoryQuery(row.q);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ q, t: row.t });
  }
  let offset = 0;
  for (const raw of server) {
    if (typeof raw !== 'string') continue;
    const q = clipHistoryQuery(raw);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ q, t: now - offset });
    offset += 1;
  }
  rows.sort((a, b) => b.t - a.t || a.q.localeCompare(b.q));
  return rows.slice(0, HISTORY_CAP);
}
