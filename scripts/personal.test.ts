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
  computeItems,
  readRelated,
  relatedSubjects,
  RELATED_KEY,
  subjectOf,
  writeRelated,
  personalizedStarters,
  readHistory,
  recordAsk,
  type Storage,
} from '../shared/personal.ts';
import { PASSING_TEXTS } from '../shared/starters.ts';

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

test('history personalizes from recent subjects with per-kind ideas, then generic fill', () => {
  const storage = memory();
  recordAsk(storage, 'best cheap headphones', 1_000);
  recordAsk(storage, 'jaylen brown injuries', 2_000);
  recordAsk(storage, 'why $rdw dropping', 3_000);
  assert.equal(categorize('should I lease or buy my next car'), 'decision');

  const shown = personalizedStarters(storage, 1280, 5_000);
  assert.equal(shown.personalized, true);
  assert.equal(shown.items.length, 4);
  const texts = shown.items.map((item) => item.text);
  assert.equal(texts[0], 'RDW stock news today');
  assert.ok(texts[1].startsWith('Jaylen Brown'), texts[1]);
  assert.ok(texts[2].includes('best cheap headphones'), texts[2]);
  assert.equal(shown.items[3].id, 'v2-earbuds-100');
  assert.ok(!texts.some((t) => /injur/i.test(t)), 'does not re-suggest the topic already asked');
});

test('subjectOf pulls tickers, sports names, people, and general topics', () => {
  assert.deepEqual(subjectOf('why $rdw dropping'), { subject: 'RDW', topic: 'dropping', kind: 'ticker' });
  assert.deepEqual(subjectOf('jaylen brown injuries'), { subject: 'jaylen brown', topic: 'injuries', kind: 'sports' });
  assert.equal(subjectOf('who is Ed chu').kind, 'person');
  assert.equal(subjectOf('best cheap headphones').kind, 'general');
});

test('related searches lead each subject lane, skipping restated topics and other names', () => {
  const history = [
    { q: 'jaylen brown injuries', t: 2, cat: 'other' as const },
    { q: 'who is Ed chu', t: 1, cat: 'other' as const },
  ];
  assert.deepEqual(relatedSubjects(history, {}).map((r) => r.key.toLowerCase()), ['jaylen brown', 'ed chu']);
  const related = {
    'jaylen brown': ['jaylen brown', 'jaylen brown injury', 'jaylen brown trade'],
    'ed chu': ['ed chung', 'ed chu linkedin'],
  };
  const texts = computeItems(history, related, 4).map((item) => item.text);
  assert.ok(texts.includes('Jaylen Brown trade'));
  assert.ok(texts.includes('Ed Chu linkedin'));
  assert.ok(!texts.some((t) => /chung|injury/i.test(t)));
  assert.deepEqual(relatedSubjects(history, related), []);
});

test('related cache round-trips and expires after 6 hours', () => {
  const storage = memory();
  writeRelated(storage, 'RDW', ['rdw stock forecast'], 1_000);
  assert.deepEqual(readRelated(storage, 2_000), { rdw: ['rdw stock forecast'] });
  assert.deepEqual(readRelated(storage, 1_000 + 6 * 60 * 60 * 1000 + 1), {});
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

test('clearHistory wipes history, starters, related, ask count, recents, and the typeahead key', () => {
  const storage = memory();
  recordAsk(storage, 'best mug', 1);
  storage.setItem(RECENT_KEY, '["best mug"]');
  storage.setItem(TYPEAHEAD_CACHE_KEY, '{}');
  storage.setItem(STARTERS_CACHE_KEY, '{}');
  writeRelated(storage, 'mug', ['mug warmer'], 5);
  assert.ok(storage.getItem(HISTORY_KEY));
  assert.ok(storage.getItem(RELATED_KEY));
  clearHistory(storage);
  assert.equal(storage.getItem(HISTORY_KEY), null);
  assert.equal(storage.getItem(STARTERS_CACHE_KEY), null);
  assert.equal(storage.getItem(ASKCOUNT_KEY), null);
  assert.equal(storage.getItem(RECENT_KEY), null);
  assert.equal(storage.getItem(TYPEAHEAD_CACHE_KEY), null);
  assert.equal(storage.getItem(RELATED_KEY), null);
  assert.equal(personalizedStarters(storage, 1280, 20).personalized, false);
});
