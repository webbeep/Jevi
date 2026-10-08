import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newLedger, searchPlan, SEARCH_CALL_CAP, type AskScope } from '../server/budget.ts';
import { diversify } from '../server/diversify.ts';
import { isStoreProductAsk, settleCardPrices } from '../shared/pricing.ts';
import { readVendorPages } from '../server/vendorPages.ts';
import {
  askedModelName, firstOfficial, isProductShopAsk, listPriceFor, officialDomains, productWords,
  stampOfficialPriceCite, storePriceFromPage, storePriceLine, vendorBuyUrl, vendorPageTargets, vendorPrices, vendorSiteQuery,
  type VendorHit,
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

test('P08 card: the vendor From price is confirmed where the tile already shows it; every retailer amount stays', () => {
  const nodes: Node[] = [
    { type: 'hero', value: '$999', label: 'iPad Pro starts at', caption: 'Best Buy sale [1]' },
    { type: 'grid', children: [
      { type: 'tile', label: 'iPad Air', value: '$529', sub: 'Amazon deal [4]' },
      { type: 'tile', label: 'iPad Pro', value: '$999.99 [1]' },
      { type: 'tile', label: 'iPad Air', value: 'From $599', source: 3 },
    ] },
    { type: 'table', columns: ['iPad Air', 'iPad Pro'], rows: [['Price', '$529 [4]', '$999.99 [1]'], ['Pencil', 'Pro', 'Pro']] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ];
  const out = settle(nodes, P08, P08_HITS);
  // The Air tile was marked, so only the iPad Pro vendor price is listed — once, before the citations.
  assert.equal(out.length, nodes.length + 1);
  assert.equal(out[3].type, 'keyvalue');
  assert.deepEqual(out[3].items.map((i: Node) => [i.label, i.value]), [['iPad Pro · apple.com', 'From $1,199 [2]']]);
  assert.equal(out[4].type, 'citations');
  const air = out[1].children[2];
  assert.equal(air.value, 'From $599');
  assert.equal(air.source, 3);
  assert.equal(air.vendorTrue, true);
  // A retailer amount that differs from the vendor price keeps its own number, unmarked.
  for (const node of [out[0], out[1].children[0], out[1].children[1]]) {
    assert.equal(node.vendorTrue, undefined, JSON.stringify(node));
  }
  assert.equal(out[0].value, '$999');
  assert.equal(out[0].caption, 'Best Buy sale [1]');
  assert.equal(out[1].children[0].value, '$529');
  assert.equal(out[1].children[0].sub, 'Amazon deal [4]');
  assert.equal(out[1].children[1].value, '$999.99 [1]');
  // Retailer prices are never removed, and no flag is written anywhere.
  for (const amount of ['$529', '$999.99', '$999']) assert.ok(dollars(out).includes(amount), amount);
  assert.equal(JSON.stringify(out).includes('vendor '), false);
  const table = out[2];
  assert.equal(table.rows[0][1], '$529 [4]');
  assert.equal(table.rows[0][2], '$999.99 [1]');
  assert.deepEqual(table.rows[1], ['Pencil', 'Pro', 'Pro']);
  assert.equal(table.priceRows, undefined);
});

// ---- P07 (SHIP-V live): AirPods and Sony fell to "No price in sources". ----
const P07 = 'AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra Earbuds, current prices';
const P07_HITS: VendorHit[] = [
  { domain: 'rtings.com', url: 'https://www.rtings.com/x', title: 'Best earbuds', snippet: 'AirPods Pro 3 $249, Sony WF-1000XM5 $299.99, Bose QC Ultra $299' },
  { domain: 'apple.com', url: 'https://www.apple.com/airpods-pro/', title: 'AirPods Pro 3 — official store', snippet: 'AirPods Pro 3: $249 on apple.com (official store price)', content: 'AirPods Pro 3: $249 on apple.com (official store price)\n\nAirPods Pro 3\n$249 or $20.75/mo. for 12 mo.' },
  { domain: 'bestbuy.com', url: 'https://www.bestbuy.com/sony', title: 'Sony WF-1000XM5', snippet: 'Sony WF-1000XM5 $228.00 Was $299.99' },
  { domain: 'whathifi.com', url: 'https://www.whathifi.com/bose', title: 'Bose QuietComfort Ultra Earbuds review', snippet: 'Bose QuietComfort Ultra Earbuds $299 / £299' },
];

test('P07 card: every product keeps its price; the AirPods vendor price is marked, the others are left alone', () => {
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
  // The tile already shows the vendor amount but cites the retailer, so it is not marked.
  assert.equal(tiles[0].value, '$249 [1]');
  assert.equal(tiles[0].vendorTrue, undefined);
  assert.equal(tiles[1].value, '$228 [3]');
  assert.equal(tiles[2].value, '$299 [4]');
  assert.deepEqual(out[1].items.map((i: Node) => i.text), nodes[1].items.map((i: Node) => i.text));
  assert.doesNotMatch(JSON.stringify(out), /Check store|No price/);
  for (const amount of ['$249', '$228', '$299']) assert.ok(dollars(out).includes(amount), amount);
  // The AirPods price is already on a tile of that product, so nothing is listed again.
  assert.equal(out.length, 3);
  // A tile that cites the vendor page instead is marked.
  const cited = settle([{ type: 'tile', label: 'AirPods Pro 3', value: '$249 [2]' }, { type: 'citations', refs: [1, 2] }], P07, P07_HITS);
  assert.equal(cited[0].value, '$249 [2]');
  assert.equal(cited[0].vendorTrue, true);
  assert.equal(cited.length, 2, 'a marked vendor price needs no store prices block');
});

// ---- P06: Kindle Paperwhite vs Kobo Clara BW. ----
const P06 = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
const P06_HITS: VendorHit[] = [
  { domain: 'theverge.com', url: 'https://theverge.com/x', title: 'Kindle vs Kobo', snippet: 'The Paperwhite is $149 and the Kobo Clara BW is $129.' },
  { domain: 'amazon.com', url: 'https://www.amazon.com/dp/B0CFPJYX7P', title: 'Kindle Paperwhite (16 GB) — official store', snippet: 'Kindle Paperwhite (16 GB): $159.99 on amazon.com (official store price)', content: 'Kindle Paperwhite (16 GB): $159.99 on amazon.com (official store price)\n\nKindle Paperwhite (16 GB)\n$159.99' },
  { domain: 'kobo.com', url: 'https://us.kobo.com/products/kobo-clara-bw', title: 'Kobo Clara BW — official store', snippet: 'Kobo Clara BW: From $139.99 on kobo.com (official store price)', content: 'Kobo Clara BW: From $139.99 on kobo.com (official store price)\n\nKobo Clara BW\nFrom $139.99' },
];

test('P06 prose: retailer amounts stay exactly as written — prose is never annotated', () => {
  const text = 'The Paperwhite is $149 [1] and the Kobo Clara BW is $129 [1].';
  const nodes: Node[] = [{ type: 'text', text }, { type: 'citations', refs: [1, 2, 3] }];
  const out = settle(nodes, P06, P06_HITS);
  assert.equal(out[0].text, text);
  // No vendor price was shown in the prose, so the card lists both once, before the citations.
  assert.equal(out.length, 3);
  assert.equal(out[1].vendorPrices, true);
  assert.equal(out[2].type, 'citations');
});

test('a vendor price the card never showed is added once as a cited Store prices block before citations', () => {
  const nodes: Node[] = [{ type: 'text', text: 'Both are great e-readers.' }, { type: 'citations', refs: [1, 2, 3] }];
  const out = settle(nodes, P06, P06_HITS);
  assert.equal(out.length, 3);
  assert.equal(out[1].type, 'keyvalue');
  assert.equal(out[1].vendorPrices, true);
  assert.deepEqual(out[1].items.map((i: Node) => [i.label, i.value]), [['Kindle Paperwhite (16 GB) · amazon.com', '$159.99 [2]'], ['Kobo Clara BW · kobo.com', 'From $139.99 [3]']]);
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

test('not a shopping ask: the card is untouched', () => {
  const nodes: Node[] = [{ type: 'text', text: 'Costs about $5.' }];
  assert.deepEqual(settle(nodes, 'WHO physical activity guidelines', P08_HITS), nodes);
});

// ---- V5: the manufacturer's own buy pages are read per product (P07/P08 live). ----
/** Apple shop pages serve schema.org JSON-LD in plain HTML (.spike/apple-ipad-pro.ldjson.txt). */
const APPLE_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"iPad Pro 11-inch (M5)","url":"https://www.apple.com/shop/buy-ipad/ipad-pro","offers":[{"@type":"Offer","priceCurrency":"USD","price":2299},{"@type":"Offer","priceCurrency":"USD","price":1199},{"@type":"Offer","priceCurrency":"USD","price":1399}]}</script>`;
/** Bose has no Offer JSON-LD: the analytics data layer carries the price (.spike/bose-qcue2.datalayer.txt). */
const BOSE_LAYER = `<script>window.dataLayer = window.dataLayer || []; var dataLayers = [{"event":"view_item","currency":"USD","ecommerce":{"items":[{"index":0,"item_id":"QCUE2-HEADPHONEIN","item_name":"Bose QuietComfort Ultra Earbuds (2nd Gen)","item_variant":"DEEP PLUM","image_url":"https://assets.bosecreative.com/transform/bb7b1552-1001-446f-bfd5-f7e2c4ee31ee/QCUEII_DeepPlum_Ecomm-Gallery-1-1634x1224?format=avif&quality=95","stock":"out_of_stock","price":299,"discount":0}]}}];</script>`;
/** Keyless Jina markdown of the Sony store page (.spike/sony-wh1000xm5.jina.md). */
const SONY_MD = `Title: Sony WH-1000XM5 Premium Wireless Noise Cancelling Headphones | Black

URL Source: https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b

Markdown Content:
*   [About](https://electronics.sony.com/#PDPAboutLink)

Model: WH-1000XM5

Sale Price $198.00

Save $201.99

Original Price~~$399.99~~

Or

Starting

/mo`;

test('storePriceFromPage: Apple JSON-LD, Bose data layer, Sony Jina markdown', () => {
  assert.deepEqual(storePriceFromPage(APPLE_LD, 'html'), { name: 'iPad Pro 11-inch (M5)', amount: 1199, from: true, via: 'ld' });
  assert.deepEqual(storePriceFromPage(BOSE_LAYER, 'html'), { name: 'Bose QuietComfort Ultra Earbuds (2nd Gen)', amount: 299, from: false, via: 'datalayer' });
  assert.deepEqual(storePriceFromPage(SONY_MD, 'markdown'), { amount: 198, from: false, was: 399.99 });
  // An AggregateOffer's low price is the "From" price.
  const agg = '<script type="application/ld+json">{"@type":"ProductGroup","name":"Sony WH-1000XM6","offers":{"@type":"AggregateOffer","priceCurrency":"USD","lowPrice":449,"highPrice":499}}</script>';
  assert.deepEqual(storePriceFromPage(agg, 'html'), { name: 'Sony WH-1000XM6', amount: 449, from: true, via: 'ld' });
  // A month plan is not the device price, and a page with no price yields nothing.
  assert.equal(storePriceFromPage('iPad Pro From $1,199 or $99.91/mo. for 12 mo.', 'markdown')?.amount, 1199);
  assert.equal(storePriceFromPage('<html><body>iPad Pro. Most advanced tech.</body></html>', 'html'), undefined);
  assert.equal(storePriceFromPage('* Save $201.99\n\nOr Starting /mo', 'markdown'), undefined);
  assert.equal(storePriceFromPage('', 'html'), undefined);
  // A non-USD offer is not the US price.
  assert.equal(storePriceFromPage('<script type="application/ld+json">{"@type":"Product","name":"iPad Air","offers":{"@type":"Offer","priceCurrency":"GBP","price":749}}</script>', 'html'), undefined);
});

test('storePriceLine names the product by its exact model, the store price and the store', () => {
  assert.equal(
    storePriceLine({ name: 'iPad Pro 11-inch (M5)', amount: 1199, from: true }, 'iPad Pro', 'apple.com'),
    'iPad Pro 11-inch (M5): From $1,199 on apple.com (official store price)',
  );
  assert.equal(
    storePriceLine({ name: 'Sony WH-1000XM5', amount: 198, from: false, was: 399.99 }, 'Sony WH-1000XM5', 'electronics.sony.com'),
    'Sony WH-1000XM5: $198 on electronics.sony.com (official store sale price; list $399.99)',
  );
  // A page name for another product never becomes the head of the line.
  assert.equal(storePriceLine({ name: 'iPad Air', amount: 749, from: true }, 'iPad Pro', 'apple.com'), 'iPad Pro: From $749 on apple.com (official store price)');
});

test('vendorBuyUrl: every compared product gets its own buy page (P07/P08)', () => {
  assert.equal(vendorBuyUrl('ipad-pro', P08), 'https://www.apple.com/shop/buy-ipad/ipad-pro');
  assert.equal(vendorBuyUrl('ipad-air', P08), 'https://www.apple.com/shop/buy-ipad/ipad-air');
  assert.equal(vendorBuyUrl('ipad', 'iPad price'), 'https://www.apple.com/shop/buy-ipad/ipad');
  assert.equal(vendorBuyUrl('airpods', P07), 'https://www.apple.com/shop/buy-airpods/airpods-pro-3');
  assert.equal(vendorBuyUrl('airpods', 'AirPods Max price'), 'https://www.apple.com/shop/buy-airpods/airpods-max');
  assert.equal(vendorBuyUrl('airpods', 'AirPods 4 price'), 'https://www.apple.com/shop/buy-airpods/airpods-4');
  assert.equal(vendorBuyUrl('airpods', 'AirPods price'), undefined, 'no model in the ask: no page');
  // Sony is never read: keyless Jina is quota-blocked from the edge and a direct read 403s.
  assert.equal(vendorBuyUrl('sony', P07), undefined);
  assert.equal(vendorBuyUrl('sony', 'Sony WH-1000XM5 price'), undefined);
  assert.equal(vendorBuyUrl('bose', P07), 'https://www.bose.com/p/earbuds/bose-quietcomfort-ultra-earbuds-2nd-gen/QCUE2-HEADPHONEIN.html');
  assert.equal(vendorBuyUrl('kobo', P06), 'https://us.kobobooks.com/products/kobo-clara-bw');
  assert.equal(vendorBuyUrl('kindle', P06), undefined);
  // Headphones over earbuds: a Sony WH model in the ask picks the headphone SKU.
  const wh = 'Sony WH-1000XM5 vs Bose QC Ultra headphones price';
  assert.equal(vendorBuyUrl('sony', wh), undefined, 'no Sony page, whatever the ask');
  assert.equal(vendorBuyUrl('bose', wh), 'https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones-2nd-gen/QCUH2-HEADPHONEARN.html');
  assert.equal(vendorBuyUrl('sony', 'Sony headphones price'), undefined);
  assert.equal(vendorBuyUrl('bose', 'Bose SoundLink price'), undefined, 'Bose pages are Ultra-only');
});

test('askedModelName: the Sony model code of the question, else the brand name', () => {
  assert.equal(askedModelName('sony', 'Sony', P07), 'Sony WF-1000XM5');
  assert.equal(askedModelName('sony', 'Sony', 'Sony WH-1000XM5 vs Bose QC Ultra headphones price'), 'Sony WH-1000XM5');
  assert.equal(askedModelName('sony', 'Sony', 'Sony wf1000xm5 price'), 'Sony WF-1000XM5', 'the hyphen is restored');
  assert.equal(askedModelName('sony', 'Sony', 'Sony headphones price'), 'Sony');
  assert.equal(askedModelName('bose', 'Bose', P07), 'Bose');
  assert.equal(askedModelName('ipad-pro', 'iPad Pro', P08), 'iPad Pro');
});

test('vendorPageTargets: buy page per product, SERP hit only when there is no buy page', () => {
  assert.deepEqual(vendorPageTargets(P08, []).map((t) => [t.id, t.url, t.domain]), [
    ['ipad-air', 'https://www.apple.com/shop/buy-ipad/ipad-air', 'apple.com'],
    ['ipad-pro', 'https://www.apple.com/shop/buy-ipad/ipad-pro', 'apple.com'],
  ]);
  assert.deepEqual(vendorPageTargets(P07, []).map((t) => t.id), ['airpods', 'bose']);
  // Sony gets no target from a SERP hit either.
  assert.deepEqual(vendorPageTargets('Sony WH-1000XM5 price', [{ domain: 'electronics.sony.com', url: 'https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b' }]), []);
  // A SERP hit never replaces the buy page, and never duplicates it.
  assert.deepEqual(vendorPageTargets(P08, [{ domain: 'apple.com', url: 'https://www.apple.com/shop/buy-ipad/ipad-air' }]).map((t) => t.url), [
    'https://www.apple.com/shop/buy-ipad/ipad-air',
    'https://www.apple.com/shop/buy-ipad/ipad-pro',
  ]);
  // No buy page for the Kindle, so its SERP hit on the vendor domain is read instead.
  assert.deepEqual(vendorPageTargets(P06, P06_HITS.map((h) => ({ domain: h.domain, url: h.url! }))), [
    { id: 'kobo', url: 'https://us.kobobooks.com/products/kobo-clara-bw', domain: 'us.kobobooks.com' },
  ]);
});

test('a store sale price stays the price and the list price rides along', () => {
  const line = 'Sony WH-1000XM5: $198 on electronics.sony.com (official store sale price; list $399.99)';
  const hits: VendorHit[] = [
    { domain: 'bestbuy.com', url: 'https://www.bestbuy.com/sony', title: 'Sony WH-1000XM5', snippet: 'Sony WH-1000XM5 $228.00 Was $299.99' },
    { domain: 'electronics.sony.com', url: 'https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b', title: 'Sony — official store', snippet: line, content: `${line}\n\nSale Price $198.00` },
  ];
  assert.deepEqual(listPriceFor(line, /\bsony\b/i), { amount: 198, from: false }, 'the "list" amount never wins');
  const prices = vendorPrices('Sony WH-1000XM5 price', hits);
  assert.deepEqual(prices.map((p) => [p.amount, p.from, p.was]), [[198, false, 399.99]]);
  // A retailer amount that differs from the store price keeps its own number, unmarked.
  const out = settle([{ type: 'tile', label: 'Sony WH-1000XM5', value: '$228 [1]' }, { type: 'citations', refs: [1, 2] }], 'Sony WH-1000XM5 price', hits);
  assert.equal(out[0].value, '$228 [1]');
  assert.equal(out[0].vendorTrue, undefined);
  assert.equal(out[0].sub, undefined);
  // A tile that already shows the store price and cites the store page is marked.
  const shown = settle([{ type: 'tile', label: 'Sony WH-1000XM5', value: '$198 [2]' }, { type: 'citations', refs: [1, 2] }], 'Sony WH-1000XM5 price', hits);
  assert.equal(shown[0].value, '$198 [2]');
  assert.equal(shown[0].vendorTrue, true);
  // The sale amount is never shown as the tile's own number, and the list price rides along in the block.
  const hero = settle([{ type: 'hero', label: 'Sony WH-1000XM5', value: '$228 [1]' }, { type: 'citations', refs: [1, 2] }], 'Sony WH-1000XM5 price', hits)[0];
  assert.equal(hero.value, '$228 [1]');
  assert.equal(hero.vendorTrue, undefined);
  const block = (settle([{ type: 'text', text: 'Sony WH-1000XM5 review.' }, { type: 'citations', refs: [1, 2] }], 'Sony WH-1000XM5 price', hits) as Node[])[1];
  assert.deepEqual(block.items.map((i: Node) => [i.label, i.value]), [['Sony WH-1000XM5 · electronics.sony.com', '$198 [2] · Sale · list $399.99']]);
});

test('P08: Air and Pro each get their own buy page price, cited (V4 shipped Air only)', () => {
  const rows: VendorHit[] = [
    { domain: 'bestbuy.com', url: 'https://www.bestbuy.com/ipad-pro', title: 'iPad Pro 11-inch (M5)', snippet: 'iPad Pro 11-inch Wi-Fi 256GB $999.99 [sale]' },
    { domain: 'apple.com', url: 'https://www.apple.com/shop/buy-ipad/ipad-air', title: 'iPad Air — official store', snippet: 'iPad Air: From $749 on apple.com (official store price)', content: 'iPad Air: From $749 on apple.com (official store price)' },
    { domain: 'apple.com', url: 'https://www.apple.com/shop/buy-ipad/ipad-pro', title: 'iPad Pro — official store', snippet: 'iPad Pro 11-inch (M5): From $1,199 on apple.com (official store price)', content: 'iPad Pro 11-inch (M5): From $1,199 on apple.com (official store price)' },
  ];
  assert.deepEqual(vendorPrices(P08, rows).map((p) => [p.id, p.amount, p.source]), [['ipad-air', 749, 2], ['ipad-pro', 1199, 3]]);
  // A tile showing the vendor amount, cited to that vendor page, is marked; a retailer amount is not.
  const out = settle([
    { type: 'tile', label: 'iPad Air', value: 'From $749 [2]' },
    { type: 'tile', label: 'iPad Pro', value: 'From $1,199 [3]' },
    { type: 'tile', label: 'iPad Air', value: '$529 [4]' },
    { type: 'citations', refs: [1, 2, 3] },
  ], P08, rows);
  assert.equal(out[0].value, 'From $749 [2]');
  assert.equal(out[0].vendorTrue, true);
  assert.equal(out[1].value, 'From $1,199 [3]');
  assert.equal(out[1].vendorTrue, true);
  assert.equal(out[2].value, '$529 [4]');
  assert.equal(out[2].vendorTrue, undefined);
  // Both vendor prices are on the card, so no store prices block is added.
  assert.equal(out.length, 4);
});

test('P07: a vendor price on the card ends the "prices not in sources" copy', () => {
  const nodes: Node[] = [
    { type: 'callout', tone: 'warning', title: 'Prices not in sources', text: 'Prices not in sources for every product.' },
    { type: 'grid', children: [{ type: 'tile', label: 'AirPods Pro 3', value: '$249 [2]' }] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ];
  const out = settle(nodes, P07, P07_HITS);
  assert.equal(out.length, nodes.length);
  assert.deepEqual(out[0], { type: 'stack', children: [] }, 'the callout is gone (an empty slot, not a pending region)');
  assert.equal(out[1].children[0].value, '$249 [2]');
  assert.equal(out[1].children[0].vendorTrue, true);
  // Prose loses the sentence too; the priced sentences stay.
  const prose = settle([
    { type: 'text', text: 'Prices not in sources for Sony and Bose. The AirPods Pro 3 are $249 at Best Buy [3].' },
    { type: 'grid', children: [{ type: 'tile', label: 'AirPods Pro 3', value: '$249 [2]' }] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ], P07, P07_HITS);
  assert.equal(prose[0].text, 'The AirPods Pro 3 are $249 at Best Buy [3].');
  // Without a vendor price on the card the copy stands: it is dropped only for a vendor price.
  const kept = settle([
    { type: 'callout', tone: 'warning', title: 'Prices not in sources', text: 'Prices not in sources for every product.' },
    { type: 'grid', children: [{ type: 'tile', label: 'AirPods Pro 3', value: '$249 [1]' }] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ], P07, P07_HITS);
  assert.equal(kept[0].title, 'Prices not in sources');
});

test('P07 table: a "—" price cell fills with the vendor price of its column', () => {
  const nodes: Node[] = [
    { type: 'table', columns: ['AirPods Pro 3', 'Sony WF-1000XM5'], rows: [['Price', '—', '$228 [3]'], ['Battery', '8h', '8h']] },
    { type: 'citations', refs: [1, 2, 3, 4] },
  ];
  const out = settle(nodes, P07, P07_HITS);
  assert.equal(out[0].rows[0][0], 'Price');
  assert.equal(out[0].rows[0][1], '$249 [2]', 'the em dash cell fills from the apple.com row');
  assert.equal(out[0].rows[0][2], '$228 [3]', 'a priced cell keeps its own retailer price');
  assert.deepEqual(out[0].rows[1], ['Battery', '8h', '8h']);
  assert.equal(out[0].priceRows[0].vendorTrue, true);
  assert.equal(out[0].priceRows[0].domain, 'apple.com');
});

const AIRPODS_LD = `<html><body><script type="application/ld+json">{"@type":"Product","name":"AirPods Pro 3","offers":{"@type":"Offer","priceCurrency":"USD","price":249}}</script><h1>AirPods Pro 3</h1><p>$249 or $20.75/mo. for 12 mo.</p></body></html>`;
/** A Bose page that refuses a direct fetch: keyless Jina reads it instead. */
const BOSE_JINA = [
  'Bose QuietComfort Ultra Earbuds (2nd Gen)',
  '',
  'From $299',
  '',
  'Or $24.91/mo. for 12 mo.',
  '',
  'World-class noise cancellation and a fit you can wear all day, with the Bose app walking you through every mode and every setting on the buds. Immersive spatial audio keeps music and calls centred, and the charging case carries two extra full charges for the week.',
].join('\n');

test('readVendorPages: JSON-LD directly, Jina for a 403, and no row without a price', async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    asked.push(url);
    if (url.startsWith('https://r.jina.ai/')) {
      // The reader wraps the page URL: the Bose page is a 403 direct, so this is what it returns.
      const page = url.slice('https://r.jina.ai/'.length);
      return new Response(page.includes('bose.com') ? BOSE_JINA : 'A product page with no price stated anywhere on it at all, however far you scroll through the copy.'.repeat(4), { headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('airpods-pro-3')) return new Response(AIRPODS_LD, { headers: { 'content-type': 'text/html' } });
    if (url.includes('bose.com')) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
    return new Response('Nothing here', { status: 404, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try {
    const ledger = newLedger();
    const scope: AskScope = { ledger, bypass: false };
    const rows = await readVendorPages(P07, [], {}, scope);
    assert.equal(rows.length, 2, 'AirPods and Bose have a page here; Sony is never read');
    // Sony has no vendor page at all: no buy URL, and no SERP-derived target either.
    assert.ok(vendorPageTargets(P07, [{ domain: 'electronics.sony.com', url: 'https://electronics.sony.com/audio/headphones/truly-wireless-earbuds/p/wf1000xm5-b' }]).every((t) => t.id !== 'sony'));
    assert.ok(!asked.some((u) => u.includes('sony')), JSON.stringify(asked));
    const [airpods, bose] = rows;
    // The row is named by the exact model its own page states.
    assert.equal(airpods.title, 'AirPods Pro 3 — official store');
    assert.equal(airpods.url, 'https://www.apple.com/shop/buy-airpods/airpods-pro-3');
    assert.equal(airpods.domain, 'apple.com');
    assert.deepEqual(airpods.engines, ['web']);
    assert.equal(airpods.snippet, 'AirPods Pro 3: $249 on apple.com (official store price)');
    assert.match(airpods.content, /^AirPods Pro 3: \$249 on apple\.com \(official store price\)\n\n/);
    assert.deepEqual(airpods.vendor, { id: 'airpods', product: 'AirPods Pro 3', amount: 249, from: false });
    // Bose refused the direct fetch, so it was read through the reader (which counts itself).
    assert.equal(bose.snippet, 'Bose: From $299 on bose.com (official store price)');
    assert.deepEqual(bose.vendor, { id: 'bose', product: 'Bose', amount: 299, from: true });
    assert.ok(asked.includes('https://r.jina.ai/https://www.bose.com/p/earbuds/bose-quietcomfort-ultra-earbuds-2nd-gen/QCUE2-HEADPHONEIN.html'));
    assert.equal(ledger.pages.direct, 2, 'two targets read, Sony is not one of them');
    // The store price survives the client-side reconcile on the row the server sent.
    const shown = settle([{ type: 'tile', label: 'AirPods Pro 3', value: '$249 [1]' }, { type: 'citations', refs: [1, 2, 3] }], P07, [
      { domain: 'rtings.com', url: 'https://www.rtings.com/x', title: 'Best earbuds', snippet: 'AirPods Pro 3 $249' },
      ...rows.map((r) => ({ domain: r.domain, url: r.url, title: r.title, snippet: r.snippet, content: r.content })),
    ]);
    assert.equal(shown[0].value, '$249 [1]', 'a retailer cite is never turned into the vendor price');
    assert.equal(shown[0].vendorTrue, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('V6 live P07: a "price gap" stat keeps its own amount, and a retailer cite is never a vendor mark', () => {
  const out = settle([
    { type: 'tile', label: 'That leaves an $80 price gap between the AirPods and XM6', value: '$80' },
    { type: 'tile', label: 'AirPods Pro 3', value: '$249 [1]' },
    { type: 'citations', refs: [1, 2] },
  ], P07, P07_HITS);
  assert.equal(out[0].value, '$80');
  assert.equal(out[0].vendorTrue, undefined);
  assert.equal(out[0].sub, undefined);
  // The tile names the product but cites the retailer, so it is not the vendor's own price.
  assert.equal(out[1].value, '$249 [1]');
  assert.equal(out[1].vendorTrue, undefined);
  assert.equal(out.length, 3, 'the $249 is already on a tile of that product: no store prices block');
});
