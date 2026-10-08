import type { NeedSigninError } from '../sse';
import { track } from './events';
import { routeGate, type GateRoute } from './logic';
import { savePending, type PendingQ } from './pending';
import { applyUsage, getAuth } from './store';

export interface GateHit {
  route: GateRoute;
  question: string;
  limit: number;
}

const listeners = new Set<(hit: GateHit) => void>();

export function onGate(fn: (hit: GateHit) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let openSheet: ((waiting: boolean) => void) | null = null;
let openSaves: (() => void) | null = null;

export function registerSheetOpener(fn: (waiting: boolean) => void) {
  openSheet = fn;
  return () => {
    if (openSheet === fn) openSheet = null;
  };
}

export function requestSheet(waiting: boolean) {
  if (!getAuth().enabled) return;
  openSheet?.(waiting);
}

export function registerSavesOpener(fn: () => void) {
  openSaves = fn;
  return () => {
    if (openSaves === fn) openSaves = null;
  };
}

export function requestSaves() {
  openSaves?.();
}

let openProfile: (() => void) | null = null;

export function registerProfileOpener(fn: () => void) {
  openProfile = fn;
  return () => {
    if (openProfile === fn) openProfile = null;
  };
}

export function requestProfile() {
  openProfile?.();
}

/** 401 from the daily gate. Does not retry. `signed` and `ip` stay off the sheet. */
export function reportNeedSignin(err: NeedSigninError, question: string, pending: PendingQ | null) {
  const route = routeGate(err.reason);
  applyUsage({
    used: err.used,
    remaining: err.remaining,
    ...(err.reason === 'ip' ? {} : { limit: err.limit }),
    ...(err.signedInKnown ? { signedIn: err.signedIn } : {}),
  });
  if (route === 'sheet' && pending) savePending(pending);
  track('gate_hit', { used: err.used, limit: err.limit, reason: err.reason || 'device' }, true);
  listeners.forEach((fn) => fn({ route, question, limit: err.limit }));
}
