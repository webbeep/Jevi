import { captureSnapshot } from './bridge';
import { track, type SignInTrigger } from './events';
import { ssSet } from './storage';
import { readFirstTouch } from './utm';

let leaving = false;

export function markLeaving() {
  leaving = true;
}

export function isLeaving() {
  return leaving;
}

/** Fire signin_start, snapshot the chat, then leave for Google. */
export function startSignIn(trigger: SignInTrigger) {
  if (leaving) return;
  track('signin_start', { trigger });
  ssSet('zo_signin_trigger', trigger);
  captureSnapshot();
  markLeaving();
  const params = new URLSearchParams();
  params.set('return', location.pathname + location.search);
  const ft = readFirstTouch();
  if (ft) {
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const) {
      const value = ft[key];
      if (value) params.set(key, value);
    }
  }
  location.assign(`/api/auth/start?${params.toString()}`);
}
