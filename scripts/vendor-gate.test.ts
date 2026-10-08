import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { settleCardPrices } from '../shared/pricing.ts';
import { sameProduct, vendorPrices, type VendorHit } from '../shared/vendorPrice.ts';

type Node = Record<string, any>;

/** The V5 live gate probes (scripts/fixtures/v5-gate/*.sse) and the question each was asked. */
const GATE: readonly [string, string][] = [
  ['P08', 'iPad Air vs iPad Pro for drawing, which one and how much?'],
  ['P07', 'AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra Earbuds, current prices'],
  ['IPADPRO', 'How much is the iPad Pro?'],
  ['IPADAIR', 'How much is the iPad Air?'],
  ['AIRPODS', 'How much are AirPods Pro 3?'],
  ['KINDLE', 'Kindle Paperwhite vs Kobo Clara BW for reading, which should I buy and what do they cost?'],
  ['SONYBOSE', 'Sony WH-1000XM5 vs Bose QC Ultra headphones price'],
];

/**
 * A fixture the way the client sees it: `search` results, each `pages` event merged into its
 * result (`content: r.content || page.text`, with the page's url and domain), the LAST node
 * per index kept, and the hits `settleCardPrices` reads the vendor prices from.
 */
function load(name: string): { query: string; nodes: Node[]; hits: VendorHit[] } {
  const query = GATE.find(([n]) => n === name)![1];
  let event = '';
  const nodes: Node[] = [];
  let search: any;
  const pages: any[] = [];
  for (const line of readFileSync(new URL(`./fixtures/v5-gate/${name}.sse`, import.meta.url), 'utf8').split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const data = JSON.parse(line.slice(5));
    if (event === 'node') nodes[data.index] = data.node;
    else if (event === 'search') search = data;
    else if (event === 'pages') pages.push(...data);
  }
  const results = (search?.results ?? []).map((r: any, i: number) => {
    const page = pages.find((p) => p.n === i + 1);
    if (!page) return r;
    let domain = r.domain;
    try {
      if (page.url) domain = new URL(page.url).hostname.replace(/^www\./, '');
    } catch {
      /* keep the result's own domain */
    }
    return { ...r, content: r.content || page.text, url: page.url || r.url, domain };
  });
  return {
    query,
    nodes,
    hits: results.map((r: any) => ({ domain: r.domain, url: r.url, title: r.title, snippet: r.snippet, content: r.content })),
  };
}

/** The card the client shows for one probe. */
const settle = (name: string): Node[] => {
  const { query, nodes, hits } = load(name);
  return settleCardPrices(nodes, query, hits) as Node[];
};

/** The raw nodes of one probe, as the server streamed them. */
const raw = (name: string): Node[] => load(name).nodes;

/** The additive "Store prices" block, so the remaining nodes line up with the raw ones. */
const withoutBlock = (nodes: Node[]): Node[] => nodes.filter((n) => !(n && n.type === 'keyvalue' && n.vendorPrices === true));

/** A price slot that says "no price" instead of naming one. */
const EMPTY = /^\s*(?:—|–|-|n\/a|not (?:stated|listed|available)|check (?:the )?store|unknown|tbd)?\s*$/i;

/** A price slot that said "no price" may be filled — its value, its source and its row meta — and nothing else may change. */
function fillOnly(raw: unknown, shown: unknown): boolean {
  if (JSON.stringify(raw) === JSON.stringify(shown)) return true;
  return typeof raw === 'string' && EMPTY.test(raw);
}

/** Every field of the card, compared as data: no word, number, icon or citation is rewritten. */
const NODE_FIELDS = ['label', 'sub', 'caption', 'text', 'title', 'unit', 'icon', 'source', 'delta', 'trend', 'active', 'imageSrc', 'imageRef', 'columns', 'refs', 'items', 'options', 'priceRows'] as const;
/** Every node, by position, keeps its own number and words. */
function assertUnchanged(shown: Node, raw: Node, path: string): void {
  for (const k of NODE_FIELDS) {
    assert.equal(JSON.stringify(shown[k]), JSON.stringify(raw[k]), `${path}.${k}: ${JSON.stringify(raw[k])} → ${JSON.stringify(shown[k])}`);
  }
  assert.ok(fillOnly(raw.value, shown.value), `${path}.value: ${JSON.stringify(raw.value)} → ${JSON.stringify(shown.value)}`);
  if (Array.isArray(raw.rows)) {
    assert.ok(Array.isArray(shown.rows), `${path}.rows`);
    raw.rows.forEach((row: string[], i: number) => row.forEach((cell, j) => {
      const now = shown.rows[i]?.[j];
      assert.ok(cell === now || (typeof cell === 'string' && EMPTY.test(cell)), `${path}.rows[${i}][${j}]: ${JSON.stringify(cell)} → ${JSON.stringify(now)}`);
    }));
  }
  ((raw.children ?? []) as Node[]).forEach((kid, i) => assertUnchanged(shown.children[i], kid, `${path}.children[${i}]`));
}

/** Every node of this type anywhere in the card. */
function find(nodes: Node[], type: string): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === type) out.push(n);
    for (const kid of n.children ?? []) out.push(...find([kid], type));
  }
  return out;
}

const tileByLabel = (nodes: Node[], label: string): Node => {
  const hit = find(nodes, 'tile').concat(find(nodes, 'stat'), find(nodes, 'hero')).find((n) => n.label === label);
  assert.ok(hit, `no tile labelled ${label}`);
  return hit;
};

test('V6 gate: every node of every probe keeps its own value, label, sub, caption, prose and table cells', () => {
  for (const [name] of GATE) {
    const shown = settle(name);
    const left = withoutBlock(shown);
    assert.equal(left.length, raw(name).length, `${name}: only the store prices block is added`);
    left.forEach((node, i) => assertUnchanged(node, raw(name)[i], `${name}[${i}]`));
  }
});

test('V6 gate: IPADPRO keeps the 13-inch configs and the screen repair price', () => {
  const shown = settle('IPADPRO');
  const tiles = find(shown, 'tile');
  for (const amount of ['$1,899', '$2,099', '$2,399', '$2,699']) {
    const tile = tiles.find((t) => t.value === amount);
    assert.ok(tile, `${amount} is gone`);
    assert.equal(tile.vendorTrue, undefined, `${amount} was marked`);
    assert.equal(tile.source, 3, `${amount} lost its citation`);
  }
  const repair = tileByLabel(shown, 'Screen repair');
  assert.equal(repair.value, '$379–$599');
  assert.equal(repair.vendorTrue, undefined);
  assert.equal(repair.sub, '9.7-inch vs 12.9-inch');
  // The vendor price itself is not repeated: the hero already shows it.
  assert.equal(withoutBlock(shown).length, raw('IPADPRO').length, 'the hero already shows the vendor price');
});

test('V6 gate: IPADAIR keeps 13-inch, Cellular and Education prices', () => {
  const shown = settle('IPADAIR');
  for (const [label, value] of [['13-inch Wi-Fi', '$799'], ['13-inch Cellular', '$949'], ['Education 11-inch', '$549'], ['11-inch Cellular', '$749']] as const) {
    const tile = tileByLabel(shown, label);
    assert.equal(tile.value, value);
    assert.equal(tile.vendorTrue, undefined, `${label} was marked`);
  }
  const hero = find(shown, 'hero')[0];
  assert.equal(hero.value, '$749');
  assert.equal(hero.caption, 'Starting price · Wi-Fi, 128GB');
  assert.equal(hero.vendorTrue, undefined, 'an uncited hero is not marked');
});

test('V6 gate: AIRPODS keeps the retailer prices and the hero, none of them marked', () => {
  const shown = settle('AIRPODS');
  const hero = find(shown, 'hero')[0];
  assert.equal(hero.label, 'Current best price');
  assert.equal(hero.value, '$179');
  assert.equal(hero.caption, '28% off $249 retail');
  assert.equal(hero.vendorTrue, undefined);
  for (const [label, value] of [['Amazon', '$179'], ['Mashable', '$189.99'], ['Swappa', '$182'], ['iClarified', '$179'], ['Official Apple price', '$249']] as const) {
    const tile = tileByLabel(shown, label);
    assert.equal(tile.value, value, `${label} value changed`);
    assert.equal(tile.vendorTrue, undefined, `${label} was marked`);
  }
  // The vendor price the card never showed is added once, cited, and nothing else changes.
  const block = shown.find((n) => n.type === 'keyvalue' && n.vendorPrices === true);
  assert.ok(block, 'the store price the card never showed is listed');
  assert.deepEqual(block.items.map((i: Node) => [i.label, i.value]), [['AirPods Pro 3 · apple.com', '$249 [3]']]);
});

test('V6 gate: KINDLE keeps the subscription row and lists the Kobo store price', () => {
  const shown = settle('KINDLE');
  const table = shown.find((n) => n.type === 'table')!;
  assert.equal(table.rows[0][0], 'Price', 'the Price row keeps its own cells');
  const subscription = table.rows.find((r: string[]) => r[0] === 'Subscription');
  assert.deepEqual(subscription, ['Subscription', '—', 'Kobo Plus Read $7.99/mo [1]']);
  assert.deepEqual(table.rows.find((r: string[]) => r[0] === 'Waterproof'), ['Waterproof', 'Yes [2]', 'Not stated']);
  assert.equal(table.priceRows, undefined, 'no cell was filled');
  const block = shown.find((n) => n.type === 'keyvalue' && n.vendorPrices === true);
  assert.ok(block, 'the Kobo store price the card never showed is listed');
  assert.deepEqual(block.items.map((i: Node) => [i.label, i.value]), [['Kobo Clara BW · us.kobobooks.com', '$159.99 [3]']]);
  // A tile that shows a different amount for the same product is never marked or rewritten.
  assert.equal(tileByLabel(shown, 'Kobo Clara BW').value, '$130');
});

test('V6 gate: P08 marks the vendor prices the tiles already show, and changes nothing else', () => {
  const shown = settle('P08');
  const air = tileByLabel(shown, 'iPad Air');
  const pro = tileByLabel(shown, 'iPad Pro');
  assert.equal(air.value, 'From $749');
  assert.equal(air.source, 3);
  assert.equal(air.vendorTrue, true);
  assert.equal(pro.value, 'From $1,199');
  assert.equal(pro.source, 4);
  assert.equal(pro.vendorTrue, true);
  // The table cites the same vendor rows and is left exactly as the designer wrote it.
  const table = shown.find((n) => n.type === 'table')!;
  assert.equal(table.rows[0][1], '$749 [3]');
  assert.equal(table.rows[0][2], '$1,199 [4]');
  assert.equal(table.priceRows, undefined);
  // Both vendor prices are already on the card, so no store prices block is added.
  assert.equal(shown.length, raw('P08').length);
});

test('V6 gate: P07 marks the AirPods and Bose prices and leaves Sony without a vendor price', () => {
  const shown = settle('P07');
  const tiles = find(shown, 'tile');
  assert.equal(tiles[0].value, '$249');
  assert.equal(tiles[0].source, 2);
  assert.equal(tiles[0].vendorTrue, true);
  assert.equal(tiles[1].value, '$299');
  assert.equal(tiles[1].source, 3);
  assert.equal(tiles[1].vendorTrue, true);
  // The table's "Not stated" cell stays as written: Sony has no vendor page to fill it from.
  const table = shown.find((n) => n.type === 'table')!;
  assert.deepEqual(table.rows, [['Apple AirPods Pro 3', '$249', '[2]'], ['Bose QuietComfort Ultra Earbuds', '$299', '[3]'], ['Sony WF-1000XM5', 'Not stated', '—']]);
  assert.equal(table.priceRows, undefined);
  // No vendor price is left for the store prices block.
  assert.equal(shown.length, raw('P07').length);
  // The Sony ask has no vendor row at all: no buy page and no SERP target to read.
  const { query, hits } = load('P07');
  assert.deepEqual(vendorPrices(query, hits).map((p) => p.id), ['airpods', 'bose']);
});

test('V6 gate: SONYBOSE leaves every Sony number alone and lists the Bose store price', () => {
  const shown = settle('SONYBOSE');
  const tile = tileByLabel(shown, 'Sony WH-1000XM5');
  assert.equal(tile.value, '$399');
  assert.equal(tile.sub, 'Retail · $298 on sale');
  assert.equal(tile.vendorTrue, undefined);
  const table = shown.find((n) => n.type === 'table')!;
  assert.deepEqual(table.rows[0], ['Sale price', '$298 [2]', '$329 [2]']);
  assert.equal(table.priceRows, undefined);
  const block = shown.find((n) => n.type === 'keyvalue' && n.vendorPrices === true);
  assert.ok(block, 'the Bose store price the card never showed is listed');
  assert.deepEqual(block.items.map((i: Node) => [i.label, i.value]), [['Bose QuietComfort Ultra Headphones (2nd Gen) · bose.com', '$449 [3]']]);
});

test('V6: an empty price slot fills from the vendor page, a priced one never does', () => {
  const { query, hits } = load('KINDLE');
  const nodes: Node[] = [
    { type: 'table', columns: ['Kindle Paperwhite', 'Kobo Clara BW'], rows: [['Price', '$150 [1]', 'Not stated'], ['Display', '6.8-inch', '6-inch']] },
    { type: 'hero', label: 'Kobo Clara BW', value: '—' },
    { type: 'stat', label: 'Kobo Clara BW', value: 'n/a' },
    { type: 'tile', label: 'Kobo Clara BW', value: '$130 [1]' },
    { type: 'tile', label: 'Kindle Paperwhite', value: 'Not stated' },
    { type: 'citations', refs: [1, 3] },
  ];
  const shown = settleCardPrices(nodes, query, hits) as Node[];
  const table = shown[0];
  assert.equal(table.rows[0][2], '$159.99 [3]', 'a "Not stated" price cell fills');
  assert.deepEqual(table.rows[1], ['Display', '6.8-inch', '6-inch'], 'a non-price row is never touched');
  assert.equal(table.rows[0][1], '$150 [1]', 'a Kindle price cell has no vendor price to fill from');
  assert.deepEqual(table.priceRows, [{ domain: 'us.kobobooks.com', vendorTrue: true }, { domain: '', vendorTrue: false }]);
  const [hero, stat, priced, kindle] = [shown[1], shown[2], shown[3], shown[4]];
  assert.equal(hero.value, '$159.99');
  assert.equal(hero.source, 3);
  assert.equal(hero.vendorTrue, true);
  assert.equal(stat.value, '$159.99');
  assert.equal(stat.vendorTrue, true);
  assert.equal(priced.value, '$130 [1]', 'a tile with its own amount is never rewritten');
  assert.equal(priced.vendorTrue, undefined);
  assert.equal(kindle.value, 'Not stated', 'no vendor price for the Kindle: nothing to fill from');
});

test('V6: sameProduct is exact — brand, variant and excluded words', () => {
  const { query, hits } = load('KINDLE');
  const kobo = vendorPrices(query, hits)[0]!;
  const pro = { id: 'ipad-pro', name: 'iPad Pro', model: 'iPad Pro 11-inch (M5)', amount: 1199, domain: 'apple.com', source: 3, from: true };
  // The node itself must name the brand: never the question's only brand.
  assert.equal(sameProduct('Kobo Clara BW $130', kobo), true);
  assert.equal(sameProduct('Clara BW $130', kobo), true);
  assert.equal(sameProduct('Kindle Paperwhite $150', kobo), false);
  assert.equal(sameProduct('E-reader $130', kobo), false);
  // A kind only the model states is fine; a kind the node states must be the model's.
  assert.equal(sameProduct('iPad Pro From $1,199', pro), true);
  assert.equal(sameProduct('iPad Pro 11-inch (M5) $1,199', pro), true);
  assert.equal(sameProduct('iPad Pro 13-inch (M5) $2,699', pro), false);
  assert.equal(sameProduct('iPad Pro M5 $1,199', pro), true);
  assert.equal(sameProduct('iPad Pro M4 $1,199', pro), false);
  assert.equal(sameProduct('iPad Pro 11-inch 256GB $1,199', pro), false, 'storage the model does not state');
  assert.equal(sameProduct('iPad Pro 11-inch (M5) Cellular $1,199', pro), false);
  assert.equal(sameProduct('iPad Air From $749', pro), false);
  // A Sony model code is the model, not a size: XM5 is not the XM6 price.
  const xm5 = { id: 'sony', name: 'Sony', model: 'Sony WF-1000XM5', amount: 249, domain: 'sony.com', source: 1, from: false };
  assert.equal(sameProduct('Sony WF-1000XM5 $249', xm5), true);
  assert.equal(sameProduct('Sony WF-1000XM6 $329.99', xm5), false);
  // A product-line word the model does not state is a different product; two variants are no one product.
  const pods = { id: 'airpods', name: 'AirPods', model: 'AirPods Pro 3', amount: 249, domain: 'apple.com', source: 3, from: false };
  assert.equal(sameProduct('AirPods Pro 3 $249', pods), true);
  assert.equal(sameProduct('AirPods Max —', pods), false);
  assert.equal(sameProduct('AirPods 4 $129', pods), false);
  const qcue = { id: 'bose', name: 'Bose', model: 'Bose QuietComfort Ultra Earbuds (2nd Gen)', amount: 299, domain: 'bose.com', source: 2, from: false };
  assert.equal(sameProduct('Bose QC Ultra Earbuds $299', qcue), true);
  assert.equal(sameProduct('Bose QC Ultra Headphones —', qcue), false);
  assert.equal(sameProduct('iPad Pro 11-inch or 13-inch $1,199', pro), false);
  // Retailer, deal, service, plan and accessory words are never that product's price.
  for (const text of [
    'iPad Pro $1,199 Amazon', 'iPad Pro deal $1,199', 'iPad Pro lowest price $1,199', 'iPad Pro used $1,199',
    'iPad Pro screen repair $379', 'iPad Pro trade-in $565', 'iPad Pro education $749', 'iPad Pro AppleCare $199',
    'iPad Pro $99/mo', 'iPad Pro Apple Pencil $129', 'iPad Pro case $79', 'iPad Pro save $100', 'iPad Pro 20% off',
    'iPad Pro Retail (SRP) $1,199', 'iPad Pro best price $1,199', 'iPad Pro lowest tracked $1,199',
  ]) {
    assert.equal(sameProduct(text, pro), false, text);
  }
});
