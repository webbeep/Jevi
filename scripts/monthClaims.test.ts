import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { monthsIn, withSourcedMonths, withoutUnsourcedMonths } from '../shared/monthClaims.ts';

const now = new Date(Date.UTC(2026, 9, 19));

test('a month no cited source states is taken out, and the rest of the sentence stays', () => {
  const sources = [
    'NYC combined sales tax rate is 8.875%.',
    'Nintendo of America will revise the MSRP of the Nintendo Switch 2 system in the U.S. from $449.99 to $499.99. Prices may vary by retailer.',
  ];
  const text: CardNode = { type: 'text', text: 'The $499.99 MSRP is the revised US price from May, up from $449.99. [2]' };
  const fixed = withSourcedMonths(text, { sources, asked: 'How much is a Switch 2?', now });
  assert.equal(fixed.type === 'text' ? fixed.text : '', 'The $499.99 MSRP is the revised US price, up from $449.99. [2]');
  const row: CardNode = { type: 'keyvalue', items: [{ label: 'Previous MSRP', value: 'Before May revision' }] };
  const kept = withSourcedMonths(row, { sources, asked: '', now });
  assert.equal(kept.type === 'keyvalue' ? kept.items[0]!.value : '', 'Before revision');
});

test('a month the source states, today\'s month, a year, and the verb "may" stay', () => {
  const sources = ['Nintendo raised the price on August 1, 2026 from $449.99 to $499.99.'];
  const dated: CardNode = { type: 'text', text: 'Raised to $499.99 on August 1, 2026 [1]. Prices may change in October.' };
  assert.equal(withSourcedMonths(dated, { sources, asked: '', now }), dated);
  assert.equal(withoutUnsourcedMonths('Launched in March 2025.', new Set()), 'Launched in 2025.');
  assert.equal(withoutUnsourcedMonths('It may rise. You May want to wait.', new Set()), 'It may rise. You May want to wait.');
  assert.deepEqual([...monthsIn('Posted 2026-05-12. Shares rose Oct 16. Updated 3/2/2026.')].sort((a, b) => a - b), [2, 4, 9]);
  assert.ok(!monthsIn('Prices may vary.').has(4));
});
