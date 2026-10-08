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

/** Starters v2 (STARTERS-v2.md, RICKY-FEEDBACK-T364 #1), in display order. */
const MEMO_PASSING = [
  'best wireless earbuds under $100',
  'air fryer vs Instant Pot for a small kitchen',
  'how to get a red wine stain out of a carpet',
  'should I lease or buy my next car',
];

test('passing starter list matches the v2 set, in order', () => {
  assert.deepEqual([...PASSING_TEXTS], MEMO_PASSING);
  assert.equal(PASSING_STARTERS.length, 4);
});

test('each shown starter showcases a different rich card type', () => {
  const cards = PASSING_STARTERS.map((s) => s.card);
  assert.ok(cards.every(Boolean));
  assert.equal(new Set(cards).size, cards.length);
  assert.ok(new Set(cards).size >= 4);
});

test('retired H set is not shown', () => {
  for (const text of ['which Google Workspace plan fits 4 people', 'help desk tool under $20/seat', 'Kindle vs Kobo for reading', '8-week plan to run my first 10K']) {
    assert.equal(PASSING_TEXTS.includes(text), false, `retired still passing: ${text}`);
  }
});

test('starters.pass.json stays in sync with PASSING_IDS and texts', () => {
  const jsonIds = passJson.passing.map((p) => p.id).sort();
  assert.deepEqual([...PASSING_IDS].sort(), jsonIds);
  for (const row of passJson.passing) {
    const starter = STARTERS.find((s) => s.id === row.id);
    assert.ok(starter, `missing starter ${row.id}`);
    assert.equal(starter!.text, row.text);
    assert.equal(starter!.group, row.group);
    assert.equal(starter!.card, (row as { card?: string }).card);
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

test('pickShown: phones get #1-#3, desktop all 4, in order, passing ids only', () => {
  const phone = pickShown(390, () => 0.5);
  assert.deepEqual(phone.map((s) => s.text), MEMO_PASSING.slice(0, 3));
  assert.ok(phone.every((s) => (PASSING_IDS as readonly string[]).includes(s.id)));

  const desktop = pickShown(1280, () => 0.1);
  assert.deepEqual(desktop.map((s) => s.text), MEMO_PASSING);
});

test('shuffle stays off while the pool is thin', () => {
  assert.equal(canShuffle(), false);
});

test('/api/suggestions payload has at least 4 passing starters', () => {
  const suggestions = allPassingSuggestions();
  assert.ok(suggestions.length >= 4);
  assert.deepEqual(suggestions.map((s) => s.text), MEMO_PASSING);
});
