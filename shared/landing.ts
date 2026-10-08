export const LANDING_KEY = 'zo:landing:v1';

/** localStorage-shaped store. Every call is wrapped so private mode cannot throw. */
export interface LandingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isLandingDismissed(store: LandingStore): boolean {
  try {
    return store.getItem(LANDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissLanding(store: LandingStore): void {
  try {
    store.setItem(LANDING_KEY, '1');
  } catch {
    /* private mode or quota */
  }
}

export function clearLanding(store: LandingStore): void {
  try {
    store.removeItem(LANDING_KEY);
  } catch {
    /* private mode */
  }
}

export function shouldShowLanding(o: {
  path: string;
  dismissed: boolean;
  hasHistory: boolean;
  authReady: boolean;
  signedIn: boolean;
  hasQuery: boolean;
}): boolean {
  if (o.authReady && o.signedIn) return false;
  if (o.hasQuery) return false;
  if (o.path === '/welcome') return true;
  return !o.dismissed && !o.hasHistory;
}
