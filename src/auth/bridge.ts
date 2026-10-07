const SNAP = 'zo_snapshot';
const MAX = 2 * 1024 * 1024;

let snapshotter: (() => unknown) | null = null;

export function registerSnapshot(fn: (() => unknown) | null) {
  snapshotter = fn;
}

/** Called immediately before the Google redirect. Skips quietly when the JSON is over 2 MB. */
export function captureSnapshot() {
  try {
    const data = snapshotter?.();
    if (data == null) return;
    const json = JSON.stringify(data);
    if (json.length > MAX) return;
    sessionStorage.setItem(SNAP, json);
  } catch {
    /* quota */
  }
}

export function peekSnapshot(): unknown {
  try {
    const raw = sessionStorage.getItem(SNAP);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function snapshotQuery(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const turns = (data as { turns?: { question?: string }[] }).turns;
  const q = turns?.[0]?.question;
  return typeof q === 'string' && q.trim() ? q.trim() : null;
}

export function takeSnapshot(): unknown {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SNAP);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    sessionStorage.removeItem(SNAP);
  } catch {
    /* ignore */
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
