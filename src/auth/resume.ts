import { getAuthQuery } from './boot';
import { track } from './events';
import { type PendingQ, takePending } from './pending';
import { setAuthNotice } from './notice';
import { ssDel } from './storage';
import { getAuth, refresh } from './store';
import { takeSnapshot } from './bridge';
import { loadPrefsAndMaybeMerge } from './sync';

export interface BootPlan {
  snapshot: unknown;
  pendingRun: PendingQ | null;
  pendingRestore: PendingQ | null;
  flushSave: boolean;
}

let applied = false;
let bootPromise: Promise<BootPlan | null> | null = null;
let bootClaimed = false;

/** First caller after paint wins, so a strict-mode remount does not replay the plan. */
export function claimBoot() {
  if (bootClaimed) return false;
  bootClaimed = true;
  return true;
}

/** After /api/auth/me. Safe to call twice; the second call is a no-op. */
export function finishBoot(): BootPlan | null {
  if (applied) return null;
  applied = true;

  const q = getAuthQuery();
  const auth = getAuth();
  const signedIn = auth.enabled && auth.signedIn;
  const success = q.status === 'ok' && signedIn;
  const failed = q.status === 'cancelled' || q.status === 'error';

  if (q.trigger) ssDel('zo_signin_trigger');

  if (!auth.enabled) {
    return { snapshot: null, pendingRun: null, pendingRestore: null, flushSave: false };
  }

  if (success) {
    const props: Record<string, unknown> = { trigger: q.trigger || 'header' };
    if (q.isNew) props.new_user = true;
    track('signin_ok', props);
  } else if (q.status === 'cancelled') {
    track('signin_error', { code: 'access_denied' });
    setAuthNotice({ kind: 'cancelled' });
  } else if (q.status === 'error' || q.status === 'ok') {
    track('signin_error', { code: q.errorCode || 'error' });
    setAuthNotice({ kind: 'error' });
  }

  const snapshot = q.status ? takeSnapshot() : null;
  let pendingRun: PendingQ | null = null;
  let pendingRestore: PendingQ | null = null;
  if (success) pendingRun = takePending();
  else if (failed || q.status === 'ok') pendingRestore = takePending();

  return { snapshot, pendingRun, pendingRestore, flushSave: success };
}

/** One /api/auth/me per page, then prefs. Does not block first paint. */
export function bootAuthOnce(): Promise<BootPlan | null> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await refresh();
      const plan = finishBoot();
      await loadPrefsAndMaybeMerge();
      return plan;
    })();
  }
  return bootPromise;
}
