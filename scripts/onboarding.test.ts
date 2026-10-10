import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ONBOARD_DEVICE_KEY, ONBOARD_USERS_KEY, completeOnboarding, shouldShowOnboarding, type OnboardStore } from '../src/onboarding.ts';

function memory(): OnboardStore & { dump: Record<string, string> } {
  const dump: Record<string, string> = {};
  return {
    dump,
    getItem: (key) => dump[key] ?? null,
    setItem: (key, value) => { dump[key] = value; },
  };
}

const fresh = { deviceDone: false, userIds: [] as string[], hasUsedApp: false, isNewUser: false, userId: null };

test('a new device with no history sees the steps', () => {
  assert.equal(shouldShowOnboarding(fresh), true);
});

test('a device that already asked, or already finished, does not', () => {
  assert.equal(shouldShowOnboarding({ ...fresh, hasUsedApp: true }), false);
  assert.equal(shouldShowOnboarding({ ...fresh, deviceDone: true }), false);
});

test('a new account sees the steps even on a device that already uses the app', () => {
  assert.equal(shouldShowOnboarding({ ...fresh, hasUsedApp: true, isNewUser: true, userId: 'u1' }), true);
  assert.equal(shouldShowOnboarding({ ...fresh, deviceDone: true, isNewUser: true, userId: 'u1', userIds: ['u1'] }), false);
});

test('finishing records the device and the account', () => {
  const store = memory();
  completeOnboarding(store, 'u1');
  assert.equal(store.dump[ONBOARD_DEVICE_KEY], '1');
  assert.deepEqual(JSON.parse(store.dump[ONBOARD_USERS_KEY] ?? '[]'), ['u1']);
  completeOnboarding(store, 'u1');
  assert.deepEqual(JSON.parse(store.dump[ONBOARD_USERS_KEY] ?? '[]'), ['u1']);
  completeOnboarding(store, null);
  assert.equal(store.dump[ONBOARD_DEVICE_KEY], '1');
});
