import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { keepStorePrices } from '../server/retailerPrice.ts';

const sources = [
  { n: 1, text: 'Harbor Buds 3 tech specs. Up to 2x more noise cancelled.', domain: 'harbor.com' },
  { n: 2, text: 'Harbor Buds 3 at Amazon: $199, down from $249 today.', domain: 'dealsite.com' },
  { n: 3, text: 'Harbor Buds 3 $219.99 Add to cart', domain: 'bestbuy.com' },
];

test('a store price stays only when a page states it for that store', () => {
  const grid: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Amazon', value: '$199', sub: 'Today [1]', source: 1 },
      { type: 'tile', label: 'Best Buy', value: '$219.99', source: 3 },
      { type: 'tile', label: 'eBay resale', value: '$94.76', source: 1 },
      { type: 'tile', label: 'Harbor list price', value: '$249', source: 2 },
      { type: 'tile', label: 'Resale', value: '$94.76', sub: 'Used, eBay listing' },
    ],
  };
  const kept = keepStorePrices(grid, sources);
  assert.equal(kept?.type, 'grid');
  if (kept?.type !== 'grid') return;
  assert.deepEqual(kept.children.map((child) => (child.type === 'tile' ? child.label : '')), ['Amazon', 'Best Buy', 'Harbor list price']);
  // The Amazon price moves to the page that states it.
  assert.equal(kept.children[0]?.type === 'tile' ? kept.children[0].source : 0, 2);
});
