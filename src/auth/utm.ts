import { lsGet, lsSet } from './storage';

const KEY = 'zo_ft';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ref_host?: string;
  landing_path?: string;
  ts: number;
}

/** Lowercase, keep [a-z0-9_.-], cap at 64. */
export function sanitizeUtm(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 64);
}

export function readFirstTouch(): FirstTouch | null {
  const raw = lsGet(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FirstTouch;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function externalHost(): string {
  if (!document.referrer) return '';
  try {
    const host = new URL(document.referrer).host;
    if (!host || host === location.host) return '';
    return sanitizeUtm(host);
  } catch {
    return '';
  }
}

/**
 * First touch, before any other startup work. Writes zo_ft when the link has
 * utm_* or an outside referrer, and the stored touch is missing or older than 30 days.
 * Strips utm_* from the address bar and keeps q.
 */
export function captureFirstTouch() {
  const params = new URLSearchParams(location.search);
  const utmKeys = [...params.keys()].filter((k) => k.startsWith('utm_'));
  const ref = externalHost();
  const existing = readFirstTouch();
  const stale = !existing || Date.now() - existing.ts > MAX_AGE;

  if (stale && (utmKeys.length > 0 || ref)) {
    const ft: FirstTouch = { landing_path: location.pathname, ts: Date.now() };
    if (ref) ft.ref_host = ref;
    for (const field of FIELDS) {
      const raw = params.get(field);
      if (raw == null) continue;
      const clean = sanitizeUtm(raw);
      if (clean) ft[field] = clean;
      else if (field === 'utm_source') ft.utm_source = 'direct';
    }
    lsSet(KEY, JSON.stringify(ft));
  }

  if (!utmKeys.length) return;
  for (const key of utmKeys) params.delete(key);
  const qs = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}
