import { peekSnapshot, snapshotQuery } from './bridge';
import { captureFirstTouch } from './utm';
import { ssGet, ssSet } from './storage';

export interface AuthQuery {
  status: 'ok' | 'cancelled' | 'error' | null;
  isNew: boolean;
  trigger: string | null;
  q: string | null;
  firstPageLoad: boolean;
}

let query: AuthQuery | null = null;

function replaceSearch(params: URLSearchParams) {
  const qs = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

/** UTM first, then read ?auth= or /error and strip them. Keeps q. Run once before render. */
export function bootCapture() {
  if (query) return;
  captureFirstTouch();
  const params = new URLSearchParams(location.search);
  const trigger = ssGet('zo_signin_trigger');
  const firstPageLoad = ssGet('zo_visit') !== '1';
  ssSet('zo_visit', '1');

  if (location.pathname === '/error') {
    const code = params.get('error') || '';
    const status = code === 'access_denied' ? 'cancelled' : 'error';
    const q = snapshotQuery(peekSnapshot());
    history.replaceState(history.state, '', q ? `/?q=${encodeURIComponent(q)}` : '/');
    query = { status, isNew: false, trigger, q, firstPageLoad };
    return;
  }

  const raw = params.get('auth');
  const status = raw === 'ok' || raw === 'cancelled' || raw === 'error' ? raw : null;
  const isNew = params.get('new') === '1';
  if (params.has('auth') || params.has('new')) {
    params.delete('auth');
    params.delete('new');
    replaceSearch(params);
  }
  query = { status, isNew, trigger, q: params.get('q'), firstPageLoad };
}

export function getAuthQuery(): AuthQuery {
  return query ?? { status: null, isNew: false, trigger: null, q: null, firstPageLoad: true };
}
