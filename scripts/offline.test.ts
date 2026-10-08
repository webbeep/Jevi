import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamError } from '../shared/sse-parse.ts';
import {
  MAX_AUTO_RECONNECTS,
  OFFLINE_MESSAGE,
  PENDING_KEY,
  RECONNECT_DELAYS_MS,
  clearPending,
  friendlyError,
  isConnectionError,
  loadPending,
  reconnectDelay,
  savePending,
  type KeyValueStore,
} from '../shared/offline.ts';

function memoryStore(): KeyValueStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
}

test('isConnectionError recognises browser fetch failures and ignores ordinary errors', () => {
  assert.equal(isConnectionError(new TypeError('Load failed')), true);
  assert.equal(isConnectionError(new TypeError('Failed to fetch')), true);
  assert.equal(isConnectionError(new Error('NetworkError when attempting to fetch resource.')), true);
  assert.equal(isConnectionError(new StreamError('Load failed', 'network', true)), true);
  const abort = new DOMException('The operation was aborted.', 'AbortError');
  assert.equal(isConnectionError(abort, true), false);
  assert.equal(isConnectionError(abort, false), true);
  assert.equal(isConnectionError(new Error('Plan failed')), false);
  const cut = new StreamError('The answer was cut off.', 'cut', true);
  assert.equal(isConnectionError(cut, false, false), false);
  assert.equal(isConnectionError(cut, false, true), true);
});

test('friendlyError hides raw network text and passes server errors through', () => {
  const samples = [
    new TypeError('Load failed'),
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    new StreamError('Load failed', 'network', true),
    new StreamError('Failed to fetch', 'network', true),
  ];
  for (const err of samples) {
    const message = friendlyError(err);
    assert.equal(message, OFFLINE_MESSAGE);
    assert.equal(message.includes('Load failed'), false);
    assert.equal(message.includes('TypeError'), false);
    assert.equal(message.includes('NetworkError'), false);
    assert.equal(message.includes('Failed to fetch'), false);
  }
  assert.equal(friendlyError(new Error('Request failed (500)')), 'Request failed (500)');
  assert.equal(friendlyError(new StreamError('Request failed (500)', 'http', false)), 'Request failed (500)');
  assert.equal(friendlyError(new StreamError('The answer was cut off.', 'cut', true)), 'The answer was cut off.');
});

test('reconnectDelay backs off and caps at 30s', () => {
  assert.deepEqual(RECONNECT_DELAYS_MS, [1000, 2000, 4000, 8000, 16000, 30000]);
  assert.equal(MAX_AUTO_RECONNECTS, 6);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((n) => reconnectDelay(n)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000],
  );
});

test('pending ask save, load, stale, garbage, and clear', () => {
  const store = memoryStore();
  const now = 1_700_000_000_000;
  savePending(store, 'weather in lisbon', now);
  assert.equal(store.raw.get(PENDING_KEY)?.includes('weather in lisbon'), true);
  assert.equal(loadPending(store, now + 1000), 'weather in lisbon');

  savePending(store, 'stale question', now);
  assert.equal(loadPending(store, now + 30 * 60 * 1000 + 1), undefined);
  assert.equal(store.raw.has(PENDING_KEY), false);

  store.setItem(PENDING_KEY, '{not json');
  assert.equal(loadPending(store, now), undefined);
  assert.equal(store.raw.has(PENDING_KEY), false);

  store.setItem(PENDING_KEY, JSON.stringify({ savedAt: now }));
  assert.equal(loadPending(store, now), undefined);

  store.setItem(PENDING_KEY, JSON.stringify({ q: '', savedAt: now }));
  assert.equal(loadPending(store, now), undefined);

  savePending(store, 'keep me', now);
  clearPending(store);
  assert.equal(loadPending(store, now), undefined);
  assert.equal(store.raw.has(PENDING_KEY), false);

  const denied: KeyValueStore = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
  assert.doesNotThrow(() => savePending(denied, 'x', now));
  assert.equal(loadPending(denied, now), undefined);
  assert.doesNotThrow(() => clearPending(denied));
});
