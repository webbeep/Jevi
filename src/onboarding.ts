/** First-run steps. Shown once per new device, and again for an account that has not seen them. */
export const ONBOARD_DEVICE_KEY = 'zo-onboarded';
export const ONBOARD_USERS_KEY = 'zo-onboarded-users';

export const ONBOARD_STEPS = [
  { title: 'Ask anything', detail: 'Type a question. ZO looks it up and answers in a card you can read.' },
  { title: 'Compare and tweak', detail: 'Change the layout, or ask a follow-up on the same card.' },
  { title: 'Keep it', detail: 'Save an answer. Sign in and it follows you to a new device.' },
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
