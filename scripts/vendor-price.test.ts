import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchPlan, SEARCH_CALL_CAP } from '../server/budget.ts';
import { diversify } from '../server/diversify.ts';
import { isStoreProductAsk, settleCardPrices } from '../shared/pricing.ts';
import {
  differsFromVendor, firstOfficial, isProductShopAsk, listPriceFor, officialDomains, priceFlag, productWords,
  stampOfficialPriceCite, vendorPrices, vendorSiteQuery, type VendorHit,
} from '../shared/vendorPrice.ts';

type Node = Record<string, any>;
const dollars = (v: unknown) => JSON.stringify(v).match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
const settle = (nodes: Node[], query: string, hits: VendorHit[]) => settleCardPrices<Node>(nodes, query, hits) as Node[];

// ---- P08 (SHIP-V live): apple.com said "From $1,199"; V2 took $999 (trade-in/old config). ----
const P08 = 'iPad Air vs iPad Pro for drawing, how much?';
const P08_HITS: VendorHit[] = [
  { domain: 'bestbuy.com', url: 'https://www.bestbuy.com/ipad-pro', title: 'Apple iPad Pro 11-inch (M5)', snippet: 'iPad Pro 11-inch Wi-Fi 256GB $999.99 [sale]' },
  { domain: 'apple.com', url: 'https://www.apple.com/ipad-pro/', title: 'iPad Pro - Apple', snippet: 'iPad Pro. Get $999 off with eligible trade-in, or $250 credit. iPad Pro from $1,199 or $99.91/mo. for 12 mo.' },
  { domain: 'apple.com', url: 'https://www.apple.com/ipad-air/', title: 'iPad Air - Apple', snippet: 'iPad Air. Starting at $599 or $49.91/mo.' },
  { domain: 'macrumors.com', url: 'https://www.macrumors.com/x', title: 'iPad Air deal', snippet: 'iPad Air drops to $529 at Amazon' },
];

test('vendor list price: From / Starting at wins; trade-in, credit and monthly amounts never do (P08)', () => {
  const pro = listPriceFor(P08_HITS[1].snippet!, /\bipad pro\b/i);
  assert.deepEqual(pro, { amount: 1199, from: true });
  assert.deepEqual(listPriceFor('iPad Air. Starting at $599 or $49.91/mo.', /\bipad air\b/i), { amount: 599, from: true });
  assert.deepEqual(listPriceFor('iPad Pro was $1,099. iPad Pro From $1,199.', /\bipad pro\b/i), { amount: 1199, from: true });
  assert.equal(listPriceFor('Save $100 on iPad Pro today', /\bipad pro\b/i), undefined);
  const prices = vendorPrices(P08, P08_HITS);
  assert.deepEqual(prices.map((p) => [p.id, p.amount, p.domain, p.source]), [['ipad-air', 599, 'apple.com', 3], ['ipad-pro', 1199, 'apple.com', 2]]);
});

test('P08 card: vendor From price is the main price, cited; retailer $999 kept with a visible >5% flag', () => {
  const nodes: Node[] = [
    { type: 'hero', value: '$999', label: 'iPad Pro starts at', caption: 'Best Buy sale [1]' },
    { type: 'grid', children: [
      { type: 'tile', label: 'iPad Air', value: '$529', sub: 'Amazon deal [4]' },
      { type: 'tile', label: 'iPad Pro', value: '$999.99 [1]' },
    ] },
    { type: 'table', columns: ['iPad Air', 'iPad Pro'], rows: [['Price', '$529 [4]', '$999.99 [1]'], ['Pencil', 'Pro', 'Pro']] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ];
  const out = settle(nodes, P08, P08_HITS);
  assert.equal(out.length, nodes.length, 'no block added: every vendor price was shown');
  const hero = out[0];
  assert.equal(hero.value, 'From $1,199');
  assert.equal(hero.vendorTrue, true);
  assert.match(hero.caption, /apple\.com \[2\]/);
  assert.match(hero.caption, /Retailer \$999 · 17% below vendor/);
  assert.deepEqual(hero.priceFlag, { vendor: 1199, other: 999, pct: 17, dir: 'below' });
  const [air, pro] = out[1].children;
  assert.equal(air.value, 'From $599');
  assert.equal(air.source, 3);
  assert.match(air.sub, /Amazon deal \[4\] · Retailer \$529 · 12% below vendor/);
  assert.equal(pro.value, 'From $1,199');
  assert.equal(pro.source, 2);
  assert.match(pro.sub, /Retailer \$999\.99 \[1\] · 17% below vendor/);
  const table = out[2];
  assert.equal(table.rows[0][1], 'From $599 [3] · $529 [4] (12% below vendor)');
  assert.equal(table.rows[0][2], 'From $1,199 [2] · $999.99 [1] (17% below vendor)');
  assert.deepEqual(table.rows[1], ['Pencil', 'Pro', 'Pro']);
  assert.equal(table.priceRows[0].vendorTrue, true);
  assert.equal(table.priceRows[0].note, 'differs from vendor');
  // Retailer prices are never removed.
  for (const amount of ['$529', '$999.99', '$999']) assert.ok(dollars(out).includes(amount), amount);
});

// ---- P07 (SHIP-V live): AirPods and Sony fell to "No price in sources". ----
const P07 = 'AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra Earbuds, current prices';
const P07_HITS: VendorHit[] = [
  { domain: 'rtings.com', url: 'https://www.rtings.com/x', title: 'Best earbuds', snippet: 'AirPods Pro 3 $249, Sony WF-1000XM5 $299.99, Bose QC Ultra $299' },
  { domain: 'apple.com', url: 'https://www.apple.com/airpods-pro/', title: 'AirPods Pro 3 - Apple', snippet: 'AirPods Pro 3. $249.' },
  { domain: 'bestbuy.com', url: 'https://www.bestbuy.com/sony', title: 'Sony WF-1000XM5', snippet: 'Sony WF-1000XM5 $228.00 Was $299.99' },
  { domain: 'whathifi.com', url: 'https://www.whathifi.com/bose', title: 'Bose QuietComfort Ultra Earbuds review', snippet: 'Bose QuietComfort Ultra Earbuds $299 / £299' },
];

test('P07 card: every product keeps its price; only AirPods gets a vendor price; nothing becomes "Check store"', () => {
  const nodes: Node[] = [
    { type: 'grid', children: [
      { type: 'tile', label: 'AirPods Pro 3', value: '$249 [1]' },
      { type: 'tile', label: 'Sony WF-1000XM5', value: '$228 [3]' },
      { type: 'tile', label: 'Bose QC Ultra', value: '$299 [4]' },
    ] },
    { type: 'list', items: [
      { text: 'AirPods Pro 3 cost $249 [1].' },
      { text: 'Sony WF-1000XM5 are $228 at Best Buy [3].' },
      { text: 'The Bose QuietComfort Ultra Earbuds are $299 [4].' },
    ] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ];
  const out = settle(nodes, P07, P07_HITS);
  const tiles = out[0].children;
  assert.equal(tiles.length, 3);
  assert.equal(tiles[0].value, '$249');
  assert.equal(tiles[0].source, 2);
  assert.equal(tiles[0].vendorTrue, true);
  assert.equal(tiles[0].sub, undefined, 'same as vendor: no retailer line');
  assert.equal(tiles[1].value, '$228 [3]');
  assert.equal(tiles[2].value, '$299 [4]');
  assert.deepEqual(out[1].items.map((i: Node) => i.text), nodes[1].items.map((i: Node) => i.text));
  assert.doesNotMatch(JSON.stringify(out), /Check store|No price/);
  for (const amount of ['$249', '$228', '$299']) assert.ok(dollars(out).includes(amount), amount);
});

// ---- P06: Kindle Paperwhite vs Kobo Clara BW. ----
const P06 = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
const P06_HITS: VendorHit[] = [
  { domain: 'theverge.com', url: 'https://theverge.com/x', title: 'Kindle vs Kobo', snippet: 'The Paperwhite is $149 and the Kobo Clara BW is $129.' },
  { domain: 'amazon.com', url: 'https://www.amazon.com/dp/B0CFPJYX7P', title: 'Kindle Paperwhite (16 GB)', snippet: 'Kindle Paperwhite $159.99' },
  { domain: 'kobo.com', url: 'https://us.kobo.com/products/kobo-clara-bw', title: 'Kobo Clara BW', snippet: 'Kobo Clara BW starting at $139.99 USD' },
];

test('P06 prose: retailer amounts stay; a >5% gap gets the cited vendor price and a flag right after it', () => {
  const nodes: Node[] = [{ type: 'text', text: 'The Paperwhite is $149 [1] and the Kobo Clara BW is $129 [1].' }, { type: 'citations', refs: [1, 2, 3] }];
  const out = settle(nodes, P06, P06_HITS);
  assert.equal(out[0].text, 'The Paperwhite is $149 [1] (vendor $159.99 [2], 7% below vendor) and the Kobo Clara BW is $129 [1] (vendor From $139.99 [3], 8% below vendor).');
  assert.equal(out.length, 2);
});

test('a vendor price the card never showed is added once as a cited Store prices block before citations', () => {
  const nodes: Node[] = [{ type: 'text', text: 'Both are great e-readers.' }, { type: 'citations', refs: [1, 2, 3] }];
  const out = settle(nodes, P06, P06_HITS);
  assert.equal(out.length, 3);
  assert.equal(out[1].type, 'keyvalue');
  assert.equal(out[1].vendorPrices, true);
  assert.deepEqual(out[1].items.map((i: Node) => [i.label, i.value]), [['Kindle · amazon.com', '$159.99 [2]'], ['Kobo · kobo.com', 'From $139.99 [3]']]);
  assert.equal(out[2].type, 'citations');
  // Still streaming (a hole): no block yet, so region placeholders keep their indices.
  const partial = settle([nodes[0], undefined as unknown as Node, nodes[1]], P06, P06_HITS);
  assert.equal(partial.length, 3);
});

// ---- P05: Workspace plan catalog keeps the pricing-table path (the one V2 win). ----
test('P05 Workspace stays on the plan path; official page still cited', () => {
  const q = 'Google Workspace Business Starter pricing per user';
  assert.equal(isProductShopAsk(q), true);
  assert.equal(isStoreProductAsk(q), false);
  const node = stampOfficialPriceCite({ type: 'text', text: 'Business Starter is $7 per user [1].' }, q, [{ domain: 'blog.example.com' }, { domain: 'workspace.google.com' }]);
  assert.equal((node as Node).text, 'Business Starter is $7 per user [1]. [2]');
});

test('search plan: literal first, then one site: vendor lookup; store pages capped at two in the result set', () => {
  assert.equal(vendorSiteQuery('iPad Air price October 2026'), 'ipad air site:apple.com');
  assert.match(vendorSiteQuery(P07)!, /site:apple\.com OR site:sony\.com OR site:bose\.com$/);
  assert.equal(productWords('Kindle Paperwhite vs Kobo Clara BW for reading, what do they cost?'), 'kindle paperwhite kobo clara bw reading');
  const plan = searchPlan(P06, ['Kindle Paperwhite vs Kobo Clara BW comparison 2026']);
  assert.equal(plan.more.length, 1);
  assert.match(plan.more[0], /site:amazon\.com/);
  assert.ok(plan.more.length + 1 <= SEARCH_CALL_CAP);
  assert.deepEqual(officialDomains(P06), ['amazon.com', 'kobo.com', 'kobobooks.com']);
  const rows = [
    { domain: 'rtings.com' }, { domain: 'bestbuy.com' }, { domain: 'whathifi.com' },
    { domain: 'apple.com' }, { domain: 'www.apple.com' }, { domain: 'support.apple.com' },
  ];
  const ranked = diversify(P07, rows, 2, 3, ['apple.com']);
  assert.deepEqual(ranked.slice(0, 2).map((r) => r.domain), ['apple.com', 'www.apple.com']);
  for (const d of ['rtings.com', 'bestbuy.com', 'whathifi.com']) assert.ok(ranked.some((r) => r.domain === d), d);
  assert.equal(firstOfficial([{ domain: 'x.com', url: 'a' }, { domain: 'apple.com', url: 'b' }], P08)?.url, 'b');
});

test('flag math', () => {
  assert.equal(differsFromVendor(1140, 1199), false);
  assert.equal(differsFromVendor(999, 1199), true);
  assert.deepEqual(priceFlag(1299, 1199), { vendor: 1199, other: 1299, pct: 8, dir: 'above' });
  assert.equal(priceFlag(1189, 1199), undefined);
});

test('not a shopping ask: the card is untouched', () => {
  const nodes: Node[] = [{ type: 'text', text: 'Costs about $5.' }];
  assert.deepEqual(settle(nodes, 'WHO physical activity guidelines', P08_HITS), nodes);
});
