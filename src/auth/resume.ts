import { sendAttribution, retryAttribution } from './attribution';
import { getAuthQuery } from './boot';
import { track } from './events';
import { setAuthNotice } from './notice';
import { takePending, type PendingQ } from './pending';
import { ssDel, lsGet } from './storage';
import { getAuth } from './store';
import { takeSnapshot } from './bridge';

export interface BootPlan {
  snapshot: unknown;
  /** Run the address-bar question only when nothing was restored from the sign-in snapshot. */
  runQ: string | null;
  pendingRun: PendingQ | null;
  pendingRestore: PendingQ | null;
  showOptIn: boolean;
}

let applied = false;

/** After /api/auth/me. Safe to call twice; the second call is a no-op. */
export function finishBoot(): BootPlan | null {
  if (applied) return null;
  applied = true;

  const q = getAuthQuery();
  const auth = getAuth();
  const signedIn = auth.enabled && auth.signedIn;
  const failed = q.status === 'cancelled' || q.status === 'error';
  const success = q.status === 'ok' || (!!q.trigger && signedIn && !failed);
  let newUser: boolean | undefined;
  if (q.isNew || auth.user?.new_user === true) newUser = true;
  else if (auth.user?.new_user === false) newUser = false;

  if (success) {
    const props: Record<string, unknown> = { trigger: q.trigger || 'header' };
    if (newUser !== undefined) props.new_user = newUser;
    track('signin_ok', props);
    ssDel('zo_signin_trigger');
    // Unknown new_user still posts once; the server writes src_utm only when it is null.
    if (newUser !== false) sendAttribution();
    else retryAttribution();
  } else if (q.status === 'cancelled') {
    ssDel('zo_signin_trigger');
    setAuthNotice({ kind: 'cancelled' });
  } else if (q.status === 'error') {
    ssDel('zo_signin_trigger');
    setAuthNotice({ kind: 'error', outOfFree: auth.remaining === 0 && auth.limit > 0 });
  } else if (signedIn) retryAttribution();

  const snapshot = takeSnapshot();
  let pendingRun: PendingQ | null = null;
  let pendingRestore: PendingQ | null = null;

  if (failed) pendingRestore = takePending();
  else if (signedIn && success) pendingRun = takePending();

  const runQ = !failed && snapshot == null && !pendingRun ? q.q : null;
  const asked = lsGet('zo_optin_asked') === '1' || auth.optinAsked;
  return {
    snapshot,
    runQ,
    pendingRun,
    pendingRestore,
    showOptIn: success && signedIn && !asked,
  };
}
