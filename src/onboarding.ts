/** First-run steps. Shown once per new device, and again for an account that has not seen them. */
export const ONBOARD_DEVICE_KEY = 'zo-onboarded';
export const ONBOARD_USERS_KEY = 'zo-onboarded-users';

/** One standout feature per card. The picture plays it; the line under it only names it. */
export const ONBOARD_STEPS = [
  { id: 'shape', title: 'Shaped to the question', line: 'The layout fits the ask: a comparison, a price, or the steps.' },
  { id: 'tap', title: 'Ask about one part', line: 'Tap a clip, a row, or a stat. The next ask keeps that subject.' },
  { id: 'live', title: 'Live prices', line: 'A ticker opens on the live quote and its chart.' },
] as const;

export interface OnboardStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readOnboardedUsers(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export interface OnboardInput {
  deviceDone: boolean;
  userIds: readonly string[];
  /** This device already has questions or recents, so it is not new. */
  hasUsedApp: boolean;
  isNewUser: boolean;
  userId: string | null;
}

/** A new device, or a new account that has not stepped through yet. */
export function shouldShowOnboarding(input: OnboardInput): boolean {
  const seenUser = Boolean(input.userId && input.userIds.includes(input.userId));
  if (input.isNewUser) return !seenUser;
  if (input.deviceDone || input.hasUsedApp || seenUser) return false;
  return true;
}

export function completeOnboarding(store: OnboardStore, userId: string | null): void {
  store.setItem(ONBOARD_DEVICE_KEY, '1');
  if (!userId) return;
  const ids = readOnboardedUsers(store.getItem(ONBOARD_USERS_KEY));
  if (ids.includes(userId)) return;
  store.setItem(ONBOARD_USERS_KEY, JSON.stringify([...ids, userId]));
}
