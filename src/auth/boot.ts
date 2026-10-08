import { peekSnapshot, snapshotQuery } from './bridge';
import { parseAuthReturn, type AuthReturnStatus } from './logic';
import { peekPending } from './pending';
import { ssGet } from './storage';
import { captureFirstTouch } from './utm';

export interface AuthQuery {
  status: AuthReturnStatus;
  isNew: boolean;
  errorCode: string | null;
  trigger: string | null;
  q: string | null;
}

let query: AuthQuery | null = null;

function remember(next: AuthQuery) {
  query = next;
}

/** UTM first, then read ?auth= and strip it. Keeps q. Run once before render. */
export function bootCapture() {
  if (query) return;
  captureFirstTouch();
  const trigger = ssGet('zo_signin_trigger');

  if (location.pathname === '/error') {
    const params = new URLSearchParams(location.search);
    const code = params.get('error') || '';
    const status = code === 'access_denied' ? 'cancelled' : 'error';
    const q = snapshotQuery(peekSnapshot());
    history.replaceState(history.state, '', q ? `/?q=${encodeURIComponent(q)}` : '/');
    remember({ status, isNew: false, errorCode: code || null, trigger, q });
    return;
  }

  const parsed = parseAuthReturn(location.search);
  if (parsed.changed) {
    const qs = parsed.search;
    history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
  const kept = new URLSearchParams(parsed.search);
  remember({
    status: parsed.status,
    isNew: parsed.isNew,
    errorCode: parsed.errorCode,
    trigger,
    q: kept.get('q'),
  });
}

export function getAuthQuery(): AuthQuery {
  return query ?? { status: null, isNew: false, errorCode: null, trigger: null, q: null };
}

/** Skip the address-bar search when a sign-in return will restore or replay it. */
export function skipInitialQuery(): boolean {
  const current = getAuthQuery();
  if (current.status === 'cancelled' || current.status === 'error') return true;
  if (current.status === 'ok' && (peekPending() || peekSnapshot())) return true;
  return false;
}
