import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ClaimSource } from '../server/claims.ts';
import { keepUsPrices } from '../server/usdPrice.ts';

test('a dollar price the pages give only in another currency leaves the card', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.amazon.ca', text: 'Sony WF-1000XM5 $329.99' },
    { n: 2, domain: 'www.techradar.com', text: 'The Pixel 10 costs £799 in the UK.' },
    { n: 3, domain: 'store.google.com', text: 'Pixel 10 from $799' },
    { n: 4, domain: 'www.bestbuy.com', text: 'AirPods Pro 3 $249.00' },
  ];
  const table: CardNode = { type: 'table', columns: ['Factor', 'AirPods Pro 3', 'Sony WF-1000XM5'], rows: [['Price', '$249 [4]', '$329.99 [1]']] };
  const next = keepUsPrices(table, pages, 'AirPods Pro 3 vs Sony WF-1000XM5');
  assert.deepEqual(next.type === 'table' ? next.rows[0] : [], ['Price', '$249 [4]', '[1]']);
  const pixel: CardNode = { type: 'tile', label: 'Pixel 10', value: '$799' };
  assert.equal(keepUsPrices(pixel, pages, 'iPhone 17 vs Pixel 10 price'), pixel);
  const canada = keepUsPrices(table, pages, 'Sony WF-1000XM5 price in Canada');
  assert.equal(canada, table);
});
