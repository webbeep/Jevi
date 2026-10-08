import { StreamError } from './sse-parse.ts';

/** Messages Safari, Chrome, and Firefox use when a fetch dies because the network did. */
const NETWORK_RE =
  /load failed|failed to fetch|networkerror|network request failed|network connection was lost|internet connection appears to be offline|the request timed out/i;

export const OFFLINE_MESSAGE = 'Waiting for connection…';

/**
 * True when `err` is a dropped connection rather than a server or user failure.
 * AbortError / TimeoutError count only when the caller did not abort (`userAborted`).
 * A cut stream counts only when `offline` (navigator.onLine is false).
 */
export function isConnectionError(err: unknown, userAborted = false, offline = false): boolean {
  if (err instanceof StreamError) {
    if (err.reason === 'network') return true;
    if (err.reason === 'cut') return offline;
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return !userAborted;
    if (err instanceof TypeError) return true;
    if (NETWORK_RE.test(err.message)) return true;
  }
  return false;
}

/** Person-facing text. Connection failures never keep the raw browser message. */
export function friendlyError(err: unknown): string {
  if (err instanceof StreamError && err.reason === 'cut') return 'The answer was cut off.';
  if (isConnectionError(err)) return OFFLINE_MESSAGE;
  if (err instanceof Error) {
    if (NETWORK_RE.test(err.message)) return OFFLINE_MESSAGE;
    return err.message;
  }
  const text = String(err);
  if (NETWORK_RE.test(text)) return OFFLINE_MESSAGE;
  return text;
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/** Backoff for auto-reconnect attempt `n` (0-based). Caps at 30s. */
export function reconnectDelay(n: number): number {
  return RECONNECT_DELAYS_MS[Math.min(n, RECONNECT_DELAYS_MS.length - 1)];
}

/** After this many failed auto-reconnects, stop scheduling. Manual Retry stays. */
export const MAX_AUTO_RECONNECTS = 6;

/**
 * Show the Retry button once `reconnects` reaches this value.
 * `0` means the offline notice always includes Retry (auto-reconnect is what backs off).
 */
export const MANUAL_RETRY_AFTER = 0;

export const PENDING_KEY = 'zo:pending:v1';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

/** Remember an ask that had not finished, so a reload can resume it. Swallows private-mode throws. */
export function savePending(store: KeyValueStore, q: string, now = Date.now()): void {
  try {
    store.setItem(PENDING_KEY, JSON.stringify({ q, savedAt: now }));
  } catch {
    /* private mode or quota */
  }
}

/** The pending ask, or undefined when missing, stale, or unreadable. Drops garbage and expired entries. */
export function loadPending(store: KeyValueStore, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS): string | undefined {
  let raw: string | null;
  try {
    raw = store.getItem(PENDING_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      store.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  const saved = parsed as { q?: unknown; savedAt?: unknown } | null;
  const q = saved && typeof saved === 'object' ? saved.q : undefined;
  const savedAt = saved && typeof saved === 'object' ? saved.savedAt : undefined;
  const fresh = typeof q === 'string' && q.trim().length > 0 && typeof savedAt === 'number' && now - savedAt <= maxAgeMs;
  if (fresh) return q;
  try {
    store.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  return undefined;
}

export function clearPending(store: KeyValueStore): void {
  try {
    store.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}
