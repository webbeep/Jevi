import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindClaims, priceFor, retargetCites, shoppingAsk, type ClaimSource } from '../server/claims.ts';
import type { CardNode } from '../shared/card.ts';

const sources: ClaimSource[] = [
  { n: 1, text: 'Minnesota wolf survey 2020. The estimate that year was 2,696 wolves.' },
  { n: 2, text: 'Wolf population plunges around Voyageurs National Park. Local packs fell 19 percent.' },
  { n: 3, text: 'Minnesota DNR 2024-25 survey. The population point estimate is 2,294 wolves.' },
];

test('a number moves to the page that states it', () => {
  const text = retargetCites('Minnesota has about 2,294 wolves, DNR 2025 [1].', sources);
  assert.match(text, /\[3\]/);
  assert.doesNotMatch(text, /\[1\]/);
  assert.doesNotMatch(text, /2025/);
  assert.match(text, /2,294/);
});

test('a tile source is the page that contains its number', () => {
  const tile: CardNode = { type: 'tile', label: 'Latest estimate', value: '2,294', sub: 'DNR 2025', source: 1 };
  const next = bindClaims(tile, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'tile' ? next.source : 0, 3);
  assert.equal(next.type === 'tile' ? next.sub : '', 'DNR');
});

test('shopping picks take a price from the page that names them', () => {
  assert.equal(shoppingAsk('Best laptop under $800'), true);
  assert.equal(shoppingAsk('how do mRNA vaccines work'), false);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The MacBook Neo starts at $699.' },
    { n: 2, text: 'Dell XPS 13 is $800. HP OmniBook 5 tested at $749.' },
  ];
  assert.deepEqual(priceFor('HP OmniBook 5', catalog), { price: '$749', n: 2 });
  const list: CardNode = {
    type: 'list',
    style: 'number',
    items: [
      { text: 'MacBook Neo', meta: '$699', source: 1 },
      { text: 'Dell XPS 13' },
      { text: 'HP OmniBook 5' },
    ],
  };
  const next = bindClaims(list, catalog, 'Best laptop under $800');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items[1]?.meta, '$800');
  assert.equal(items[2]?.meta, '$749');
  assert.equal(items[0]?.meta, '$699');
});
