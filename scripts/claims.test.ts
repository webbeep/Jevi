import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindClaims, budgetAmounts, claimSources, priceFor, retargetCites, salesTax, shoppingAsk, type ClaimSource } from '../server/claims.ts';
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

test('a number no page states is dropped instead of cited', () => {
  const text = retargetCites('Minnesota has about 2,300 wolves [1].', sources);
  assert.doesNotMatch(text, /2,300/);
  assert.doesNotMatch(text, /\[1\]/);
  const tile: CardNode = { type: 'tile', label: 'Latest', value: '~2,300', sub: 'DNR 2025', source: 1 };
  const next = bindClaims(tile, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'tile' ? next.value : 'x', undefined);
});

test('shopping picks take a price from the page that names them', () => {
  assert.equal(shoppingAsk('Best laptop under $800'), true);
  assert.equal(shoppingAsk('how do mRNA vaccines work'), false);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The MacBook Neo starts at $699.' },
    { n: 2, text: 'Dell XPS 13 is $800. HP OmniBook 5 tested at $749.' },
  ];
  assert.deepEqual(priceFor('HP OmniBook 5', catalog), { price: '$749', n: 2 });
  assert.deepEqual(priceFor('MacBook Neo (A18 Pro)', catalog), { price: '$699', n: 1 });
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

test('a budget ceiling is not the product price', () => {
  assert.deepEqual(budgetAmounts('Best laptop under $800'), [800]);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'Dell XPS 13 is $999.99. Other thin laptops stay under $800.' },
  ];
  const list: CardNode = { type: 'list', style: 'number', items: [{ text: 'Dell XPS 13', meta: 'Under $800' }] };
  const next = bindClaims(list, catalog, 'Best laptop under $800');
  assert.equal(next.type === 'list' ? next.items[0]?.meta : '', '$999.99');
});

test('a city sales tax uses the combined rate once the item clears the exemption', () => {
  const pages: ClaimSource[] = [
    { n: 1, text: 'New York State sales tax is 4%.' },
    { n: 2, text: 'The combined sales tax rate in New York City is 8.875%. Clothing and footwear priced under $110 are exempt from the 4% state tax. Items $110 and up pay the full combined rate.' },
  ];
  assert.deepEqual(salesTax('sales tax on $150 sneakers in New York City', pages), { rate: 8.875, n: 2 });
  const text: CardNode = { type: 'text', text: 'Sales tax is 4% ($6).' };
  const next = bindClaims(text, pages, 'What is the sales tax on $150 sneakers in New York City?');
  const body = next.type === 'text' ? next.text : '';
  assert.match(body, /8\.875%/);
  assert.match(body, /\$13\.31/);
  assert.match(body, /\[2\]/);
  assert.doesNotMatch(body, /4%/);
});

test('a fetched page, not its snippet, is what a cited number has to match', () => {
  const page = claimSources(
    [{ title: 'Wolf news', snippet: 'The DNR counted 2,900 wolves.', domain: 'www.mprnews.org' }],
    [{ n: 1, text: 'A feature about the survey. It does not give a population figure.' }],
  );
  const text = retargetCites('Minnesota has about 2,900 wolves [1].', page);
  assert.doesNotMatch(text, /2,900/);
});

test('an agency label stays only when the cited host is that agency', () => {
  const news: ClaimSource[] = [{ n: 1, text: 'The 2023 count was 2,294 wolves.', domain: 'www.mprnews.org' }];
  const tile: CardNode = { type: 'tile', label: 'Latest estimate', value: '2,294', sub: 'DNR 2023', source: 1 };
  const next = bindClaims(tile, news, 'How many wolves are in Minnesota?');
  assert.doesNotMatch(next.type === 'tile' ? next.sub ?? '' : '', /DNR/);
  assert.match(next.type === 'tile' ? next.sub ?? '' : '', /2023/);
  const dnr: ClaimSource[] = [{ n: 1, text: 'The 2023 count was 2,294 wolves.', domain: 'files.dnr.state.mn.us' }];
  const kept = bindClaims(tile, dnr, 'How many wolves are in Minnesota?');
  assert.match(kept.type === 'tile' ? kept.sub ?? '' : '', /DNR/);
});

test('a product list drops a pick that has no price and keeps one that does', () => {
  assert.equal(shoppingAsk('best hdmi cable for a tv'), true);
  assert.equal(shoppingAsk('best ways to sleep'), false);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The MonoPrice cable is $8.99. Another listing has no price.' },
  ];
  const list: CardNode = {
    type: 'list',
    style: 'number',
    items: [{ text: 'MonoPrice HDMI cable' }, { text: 'No name cable' }],
  };
  const next = bindClaims(list, catalog, 'best hdmi cable for a tv');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.meta, '$8.99');
});

test('a table drops a number no page states', () => {
  const table: CardNode = { type: 'table', columns: ['Year', 'Estimate'], rows: [['2024', '2,900']] };
  const next = bindClaims(table, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'table' ? next.rows[0]?.[1] : '', '');
});
