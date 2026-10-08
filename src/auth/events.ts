import { getAuth } from './store';
import { ssGet, ssSet } from './storage';
import { readFirstTouch } from './utm';

export type AskFrom = 'typed' | 'suggestion' | 'q_link';
export type SignInTrigger = 'value' | 'soft' | 'wall' | 'welcome' | 'header' | 'onetap' | 'save';

const SID = 'zo_sid';
const FIRST = 'zo_first_ask';
const ASKS = 'zo_session_asks';

function sid(): string {
  const existing = ssGet(SID);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  ssSet(SID, next);
  return next;
}

function baseProps(extra: Record<string, unknown>): Record<string, unknown> {
  const ft = readFirstTouch();
  const auth = getAuth();
  const props: Record<string, unknown> = {
    sid: sid(),
    device: window.innerWidth < 768 ? 'mobile' : 'desktop',
    path: location.pathname,
    utm_source: ft?.utm_source || 'direct',
    signed_in: auth.signedIn,
    ...extra,
  };
  if (ft?.utm_medium) props.utm_medium = ft.utm_medium;
  if (ft?.utm_campaign) props.utm_campaign = ft.utm_campaign;
  if (ft?.utm_content) props.utm_content = ft.utm_content;
  if (ft?.ref_host) props.ref_host = ft.ref_host;
  if (auth.arm) props.arm = auth.arm;
  for (const key of ['email', 'name', 'avatar', 'query', 'question', 'answer', 'card', 'q', 'credential']) {
    delete props[key];
  }
  return props;
}

/** POST /api/events. Never throws. Skipped unless sign-in is enabled, unless `force` (a 401 already proved the gate is on). */
export function track(name: string, extra: Record<string, unknown> = {}, force = false) {
  try {
    if (!force && !getAuth().enabled) return;
    const body = JSON.stringify({ name, props: baseProps(extra) });
    const blob = new Blob([body], { type: 'application/json' });
    const queued = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/events', blob);
    if (!queued) {
      void fetch('/api/events', { method: 'POST', body: blob, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/** First accepted ask in this tab, then a session counter for One Tap. */
export function noteAskAccepted(from: AskFrom) {
  const n = Number(ssGet(ASKS) || '0') + 1;
  ssSet(ASKS, String(n));
  if (!ssGet(FIRST)) {
    ssSet(FIRST, '1');
    track('first_ask', { from });
  }
  window.dispatchEvent(new Event('zo-ask'));
}

export function sessionAskCount(): number {
  return Number(ssGet(ASKS) || '0');
}
