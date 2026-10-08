import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PASSING_IDS,
  PASSING_STARTERS,
  PASSING_TEXTS,
  STARTERS,
  allPassingSuggestions,
  canShuffle,
  pickShown,
  shownCount,
} from '../shared/starters.ts';

const here = dirname(fileURLToPath(import.meta.url));
const passJson = JSON.parse(readFileSync(join(here, '../shared/starters.pass.json'), 'utf8')) as {
  passing: { id: string; text: string; group: string }[];
};

/** Memo §2 PASS rows + CoS ruling: ship H with this set only. */
const MEMO_PASSING = [
  'which Google Workspace plan fits 4 people',
  'help desk tool under $20/seat',
  'Kindle vs Kobo for reading',
  '8-week plan to run my first 10K',
];

test('passing starter list matches the decision memo set', () => {
  assert.deepEqual([...PASSING_TEXTS].sort(), [...MEMO_PASSING].sort());
  assert.equal(PASSING_STARTERS.length, 4);
  assert.equal(PASSING_STARTERS.filter((s) => s.group === 's1').length, 2);
  assert.equal(PASSING_STARTERS.filter((s) => s.group === 'broad').length, 2);
});

test('starters.pass.json stays in sync with PASSING_IDS and texts', () => {
  const jsonIds = passJson.passing.map((p) => p.id).sort();
  assert.deepEqual([...PASSING_IDS].sort(), jsonIds);
  for (const row of passJson.passing) {
    const starter = STARTERS.find((s) => s.id === row.id);
    assert.ok(starter, `missing starter ${row.id}`);
    assert.equal(starter!.text, row.text);
    assert.equal(starter!.group, row.group);
  }
});

test('legacy defaults are not in the passing pool', () => {
  const banned = [
    'Plan a 3-day Tokyo trip on a budget',
    'iPhone 17 or Pixel 10 for photos?',
    'Dinner ideas with chicken and rice',
    'Explain how mortgages work',
    'Is now a good time to buy a TV?',
  ];
  for (const text of banned) {
    assert.equal(PASSING_TEXTS.includes(text), false, `legacy still passing: ${text}`);
  }
});

test('shown count is 3 on phone and 4 on desktop', () => {
  assert.equal(shownCount(390), 3);
  assert.equal(shownCount(640), 3);
  assert.equal(shownCount(641), 4);
  assert.equal(shownCount(1280), 4);
});

test('pickShown respects mix and only uses passing ids', () => {
  const phone = pickShown(390, () => 0.5);
  assert.equal(phone.length, 3);
  assert.equal(phone.filter((s) => s.group === 's1').length, 2);
  assert.equal(phone.filter((s) => s.group === 'broad').length, 1);
  assert.ok(phone.every((s) => (PASSING_IDS as readonly string[]).includes(s.id)));

  const desktop = pickShown(1280, () => 0.5);
  assert.equal(desktop.length, 4);
  assert.equal(desktop.filter((s) => s.group === 's1').length, 2);
  assert.equal(desktop.filter((s) => s.group === 'broad').length, 2);
});

test('shuffle stays off while the pool is thin', () => {
  assert.equal(canShuffle(), false);
});

test('/api/suggestions payload has at least 4 passing starters', () => {
  const suggestions = allPassingSuggestions();
  assert.ok(suggestions.length >= 4);
  assert.deepEqual(suggestions.map((s) => s.text).sort(), [...MEMO_PASSING].sort());
});
