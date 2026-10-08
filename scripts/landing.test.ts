import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearLanding, dismissLanding, isLandingDismissed, LANDING_KEY, shouldShowLanding, type LandingStore } from '../shared/landing.ts';

function memory(): LandingStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function throwing(which: 'get' | 'set' | 'remove'): LandingStore {
  return {
    getItem: () => {
      if (which === 'get') throw new Error('private');
      return null;
    },
    setItem: () => {
      if (which === 'set') throw new Error('quota');
    },
    removeItem: () => {
      if (which === 'remove') throw new Error('private');
    },
  };
}

const base = {
  path: '/',
  dismissed: false,
  hasHistory: false,
  authReady: true,
  signedIn: false,
  hasQuery: false,
};

test('dismiss writes 1 and isLandingDismissed reads it', () => {
  const store = memory();
  assert.equal(isLandingDismissed(store), false);
  dismissLanding(store);
  assert.equal(store.data.get(LANDING_KEY), '1');
  assert.equal(isLandingDismissed(store), true);
  clearLanding(store);
  assert.equal(store.data.has(LANDING_KEY), false);
  assert.equal(isLandingDismissed(store), false);
});

test('storage errors are swallowed', () => {
  assert.equal(isLandingDismissed(throwing('get')), false);
  assert.doesNotThrow(() => dismissLanding(throwing('set')));
  assert.doesNotThrow(() => clearLanding(throwing('remove')));
});

test('signed-in and ready never shows, including /welcome and a fresh device', () => {
  assert.equal(shouldShowLanding({ ...base, signedIn: true }), false);
  assert.equal(shouldShowLanding({ ...base, signedIn: true, path: '/welcome', dismissed: false, hasHistory: false }), false);
});

test('signed-in before auth is ready still follows the other rules', () => {
  assert.equal(shouldShowLanding({ ...base, authReady: false, signedIn: true }), true);
  assert.equal(shouldShowLanding({ ...base, authReady: false, signedIn: true, path: '/welcome', dismissed: true, hasHistory: true }), true);
});

test('a query deep link never shows', () => {
  assert.equal(shouldShowLanding({ ...base, hasQuery: true }), false);
  assert.equal(shouldShowLanding({ ...base, hasQuery: true, path: '/welcome' }), false);
});

test('/welcome ignores dismissed and history', () => {
  assert.equal(shouldShowLanding({ ...base, path: '/welcome', dismissed: true, hasHistory: true }), true);
});

test('home shows only for a signed-out first visit', () => {
  assert.equal(shouldShowLanding(base), true);
  assert.equal(shouldShowLanding({ ...base, dismissed: true }), false);
  assert.equal(shouldShowLanding({ ...base, hasHistory: true }), false);
  assert.equal(shouldShowLanding({ ...base, dismissed: true, hasHistory: true }), false);
  assert.equal(shouldShowLanding({ ...base, authReady: false }), true);
});
