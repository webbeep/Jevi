import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASKCOUNT_KEY,
  HISTORY_KEY,
  RECENT_KEY,
  STARTERS_CACHE_KEY,
  TYPEAHEAD_CACHE_KEY,
  categorize,
  clearHistory,
  personalizedStarters,
  readHistory,
  recordAsk,
  type Storage,
} from '../shared/personal.ts';
import { PASSING_TEXTS } from '../shared/starters.ts';

const DAY = 24 * 60 * 60 * 1000;

function memory(): Storage {
  const box = new Map<string, string>();
  return {
    getItem: (key) => (box.has(key) ? box.get(key)! : null),
    setItem: (key, value) => { box.set(key, value); },
    removeItem: (key) => { box.delete(key); },
  };
}

test('cold start returns the generic Strategy set and does not cache', () => {
  const storage = memory();
  const phone = personalizedStarters(storage, 390, 1);
  const desktop = personalizedStarters(storage, 1280, 1);
  assert.equal(phone.personalized, false);
  assert.equal(desktop.personalized, false);
  assert.deepEqual(phone.items.map((item) => item.text), PASSING_TEXTS.slice(0, 3));
  assert.deepEqual(desktop.items.map((item) => item.text), [...PASSING_TEXTS]);
  assert.equal(storage.getItem(STARTERS_CACHE_KEY), null);
});

test('history ranks starters by category and puts the last-ask follow-on first', () => {
  const storage = memory();
  recordAsk(storage, 'best cheap headphones', 1_000);
  recordAsk(storage, 'best robot vacuum under $200', 2_000);
  assert.equal(categorize('should I lease or buy my next car'), 'decision');
  assert.equal(readHistory(storage)[0].cat, 'shopping');

  const shown = personalizedStarters(storage, 1280, 5_000);
  assert.equal(shown.personalized, true);
  assert.equal(shown.items.length, 4);
  assert.equal(shown.items[0].id, 'p-last');
  assert.equal(shown.items[0].icon, 'history');
  assert.equal(shown.items[0].text, 'compare top picks for best robot vacuum under $200');
  assert.equal(shown.items[1].id, 'v2-earbuds-100');
  assert.equal(shown.items[2].id, 'v2b-robot-vacuum-300');

  const cached = JSON.parse(storage.getItem(STARTERS_CACHE_KEY) ?? '{}') as { at: number; items: { id: string }[] };
  assert.equal(cached.at, 5_000);
  assert.ok(cached.items.length >= 4);
  const ids = cached.items.map((item) => item.id);
  assert.ok(ids.indexOf('v2-earbuds-100') < ids.indexOf('v2b-robot-vacuum-300'));
  assert.ok(ids.indexOf('v2b-robot-vacuum-300') < ids.indexOf('v2-airfryer-instantpot'));
});

test('starter cache is reused within 24h and fewer than 5 new asks, then recomputed', () => {
  const storage = memory();
  recordAsk(storage, 'best cheap headphones', 1_000);
  recordAsk(storage, 'best robot vacuum under $200', 2_000);
  personalizedStarters(storage, 1280, 5_000);

  recordAsk(storage, 'how to boil water', 3_000);
  recordAsk(storage, 'how to fold a shirt', 4_000);
  recordAsk(storage, 'how to iron a shirt', 5_000);
  recordAsk(storage, 'how to sew a button', 6_000);
  const reused = personalizedStarters(storage, 1280, 7_000);
  const cached = JSON.parse(storage.getItem(STARTERS_CACHE_KEY) ?? '{}') as { at: number; asksAtCompute: number };
  assert.equal(cached.at, 5_000);
  assert.equal(cached.asksAtCompute, 2);
  assert.equal(reused.items[1].id, 'v2-earbuds-100');

  recordAsk(storage, 'how to jump a battery', 8_000);
  const recomputed = personalizedStarters(storage, 1280, 9_000);
  const next = JSON.parse(storage.getItem(STARTERS_CACHE_KEY) ?? '{}') as { at: number; asksAtCompute: number };
  assert.equal(next.at, 9_000);
  assert.equal(next.asksAtCompute, 7);
  assert.equal(recomputed.items[0].id, 'p-last');
  assert.equal(recomputed.items[0].text, 'how to jump a battery — common mistakes');
  assert.equal(recomputed.items[1].id, 'v2-wine-stain');
});

test('starter cache recomputes after 24 hours', () => {
  const storage = memory();
  recordAsk(storage, 'best cheap mug', 1_000);
  personalizedStarters(storage, 1280, 10_000);
  personalizedStarters(storage, 1280, 10_000 + DAY - 1);
  assert.equal(JSON.parse(storage.getItem(STARTERS_CACHE_KEY) ?? '{}').at, 10_000);
  personalizedStarters(storage, 1280, 10_000 + DAY);
  assert.equal(JSON.parse(storage.getItem(STARTERS_CACHE_KEY) ?? '{}').at, 10_000 + DAY);
});

test('history is newest-first, deduped, and capped at 50', () => {
  const storage = memory();
  recordAsk(storage, 'Best earbuds', 1);
  recordAsk(storage, 'best earbuds', 2);
  const once = readHistory(storage);
  assert.equal(once.length, 1);
  assert.equal(once[0].t, 2);
  assert.equal(once[0].cat, 'shopping');

  for (let i = 0; i < 60; i++) recordAsk(storage, `how to task ${i}`, i + 10);
  const history = readHistory(storage);
  assert.equal(history.length, 50);
  assert.equal(history[0].q, 'how to task 59');
  assert.equal(storage.getItem(ASKCOUNT_KEY), '62');
});

test('clearHistory wipes history, starters, ask count, recents, and the typeahead key', () => {
  const storage = memory();
  recordAsk(storage, 'best mug', 1);
  storage.setItem(RECENT_KEY, '["best mug"]');
  storage.setItem(TYPEAHEAD_CACHE_KEY, '{}');
  personalizedStarters(storage, 1280, 10);
  assert.ok(storage.getItem(HISTORY_KEY));
  assert.ok(storage.getItem(STARTERS_CACHE_KEY));
  clearHistory(storage);
  assert.equal(storage.getItem(HISTORY_KEY), null);
  assert.equal(storage.getItem(STARTERS_CACHE_KEY), null);
  assert.equal(storage.getItem(ASKCOUNT_KEY), null);
  assert.equal(storage.getItem(RECENT_KEY), null);
  assert.equal(storage.getItem(TYPEAHEAD_CACHE_KEY), null);
  assert.equal(personalizedStarters(storage, 1280, 20).personalized, false);
});
