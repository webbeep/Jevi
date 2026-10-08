import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { clearDeadEngines, newLedger, searchCalls, SEARCH_CALL_CAP } from '../server/budget.ts';
import { searchPlan } from '../server/budget.ts';
import { search } from '../server/search.ts';
import type { Env } from '../server/util.ts';
import { settleCardPrices } from '../shared/pricing.ts';
import { differsFromVendor, domainOk, firstOfficial, isProductShopAsk, officialDomains, plannerDomainOk, productWords, reconcileProductPrices, stampOfficialPriceCite, vendorSiteQuery } from '../shared/vendorPrice.ts';

const dollars = (v: unknown) => JSON.stringify(v).match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
const recorded = (name: string): { query: string; nodes: { index: number; node: any }[] } =>
  JSON.parse(readFileSync(new URL(`./fixtures/h2h-${name}-nodes.json`, import.meta.url), 'utf8'));

test('domain map sends top brands to the manufacturer and checks a planner site: guess', () => {
  assert.deepEqual(officialDomains('Kindle Paperwhite vs Kobo Clara BW, what do they cost?'), ['amazon.com', 'kobo.com', 'kobobooks.com']);
  assert.deepEqual(officialDomains('iPad Air vs iPad Pro for drawing, how much?'), ['apple.com']);
  assert.ok(officialDomains('AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra, current prices').includes('sony.com'));
  assert.ok(officialDomains('Google Workspace Business Starter pricing').includes('workspace.google.com'));
  const guessed = officialDomains('What does the Acme phone cost?', ['site:acme.com price']);
  assert.ok(guessed.includes('acme.com'));
  assert.equal(plannerDomainOk('theverge.com', 'Kindle Paperwhite price'), false);
  assert.equal(domainOk('not a domain'), false);
  assert.equal(domainOk('..com'), false);
  assert.equal(isProductShopAsk('Kindle Paperwhite vs Kobo Clara BW, what do they cost?'), true);
  assert.equal(isProductShopAsk('WHO physical activity guidelines'), false);
});

test('the store lookup is a site: query inside the three-call budget', () => {
  const literal = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
  const query = vendorSiteQuery(literal)!;
  assert.match(query, /^site:amazon\.com or site:kobo\.com /);
  assert.match(query, /kindle paperwhite/);
  // A month or year is what pulls deal roundups instead of the store page.
  assert.equal(vendorSiteQuery('iPad Air price October 2026'), 'site:apple.com ipad air');
  assert.equal(vendorSiteQuery('WHO physical activity guidelines'), undefined);
  assert.equal(productWords('Kindle Paperwhite vs Kobo Clara BW for reading, what do they cost?'), 'kindle paperwhite vs kobo clara bw reading');

  const plan = searchPlan(literal, ['Kindle Paperwhite vs Kobo Clara BW comparison 2026']);
  assert.deepEqual(plan.more, [query]);
  assert.deepEqual(plan.vendorDomains, ['amazon.com', 'kobo.com', 'kobobooks.com']);
  const deep = searchPlan(literal, ['Kindle Paperwhite vs Kobo Clara BW comparison 2026', 'Kindle Paperwhite price October 2026']);
  assert.deepEqual(deep.more, [query, 'Kindle Paperwhite vs Kobo Clara BW comparison 2026']);
  assert.ok(deep.more.length + 1 <= SEARCH_CALL_CAP);
  // Not a shopping ask: the planner's rewrites are the plan, untouched.
  assert.equal(searchPlan('WHO physical activity guidelines', ['WHO guidelines adults']).vendorDomains, undefined);
  assert.deepEqual(searchPlan('WHO physical activity guidelines', ['WHO guidelines adults']).more, ['WHO guidelines adults']);
  // With no planner rewrite the store lookup still runs, still inside the cap.
  assert.deepEqual(searchPlan(literal, []).more, [query]);
});

test('the vendor query keeps store pages the junk-word filter would drop, and ranks stores first', () => {
  const results = [
    { domain: 'theverge.com', url: 'https://theverge.com/x', title: 'Kindle', snippet: 'A roundup of e-readers' },
    { domain: 'amazon.com', url: 'https://www.amazon.com/dp/B0CFPJYX7P', title: 'Kindle Paperwhite', snippet: 'Kindle Paperwhite $199.99' },
  ];
  const store = firstOfficial(results, 'Kindle Paperwhite price');
  assert.equal(store?.url, 'https://www.amazon.com/dp/B0CFPJYX7P');
  assert.equal(firstOfficial(results, 'WHO physical activity guidelines'), undefined);
});

test('vendor price wins, a gap over 5% is flagged, and each product keeps one price', () => {
  const query = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
  const hits = [
    { domain: 'theslicklist.com', title: 'Roundup', snippet: 'Kindle Paperwhite is $159.99 and the Kobo is $149.99' },
    { domain: 'amazon.com', url: 'https://www.amazon.com/kindle', title: 'Kindle Paperwhite', snippet: 'Kindle Paperwhite $199.99' },
    { domain: 'kobo.com', url: 'https://www.kobo.com/clara', title: 'Kobo Clara BW', snippet: 'Kobo Clara BW From $159.99' },
  ];
  const nodes = [
    { type: 'tile', label: 'Kindle Paperwhite', value: '$159.99', source: 1 },
    { type: 'tile', label: 'Kindle Paperwhite', value: '$149.99', source: 1 },
    { type: 'tile', label: 'Kobo Clara BW', value: '$149.00', source: 1 },
    { type: 'table', columns: ['Kindle Paperwhite', 'Kobo Clara BW'], rows: [['Price', '$159.99 [1]', '$149 [1]']] },
  ];
  const shown = reconcileProductPrices(nodes, query, hits) as any[];
  assert.equal(shown[0].value.includes('$199.99'), true);
  assert.equal(shown[0].vendorTrue, true);
  assert.equal(shown[0].source, 2);
  assert.match(shown[0].value, /differs from vendor/);
  assert.equal(shown[1].value, 'Check store');
  assert.match(shown[2].value, /\$159\.99/);
  assert.match(shown[2].value, /differs from vendor/);
  assert.equal(dollars(shown[3]).length, 0);
  const amounts = dollars(shown);
  assert.equal(amounts.filter((d) => d.includes('199.99')).length, 1);
  assert.equal(amounts.filter((d) => d.includes('159.99')).length, 1);
  // The store page's own result number is what a vendor price cites.
  assert.match(shown[0].value, /\[2\]/);
  assert.equal(differsFromVendor(105, 100), false);
  assert.equal(differsFromVendor(106, 100), true);
  const close = reconcileProductPrices(
    [{ type: 'tile', label: 'Kindle Paperwhite', value: '$195' }],
    query,
    hits,
  ) as any[];
  assert.equal(close[0].value.includes('differs'), false);
  assert.match(close[0].value, /\$199\.99/);
});

test('P05 / P06 / P08-style cards: the store price wins, the store page is cited, one price per product', () => {
  // P05 stays a plan card: its pricing table keeps sourced prices, and the official
  // plan page is what those prices cite.
  const p05 = settleCardPrices(recorded('p05').nodes.map((n) => n.node), recorded('p05').query) as any[];
  const plan = p05.find((n) => n.type === 'pricing');
  assert.equal(plan.plans[0].prices[0].amount, 7);
  assert.equal(plan.plans[0].prices[0].sourceUrl, 'https://truehost.com/google-workspace-business-pricing/');
  const starter = stampOfficialPriceCite({ type: 'hero', value: '$7', caption: 'Business Starter' }, recorded('p05').query, [
    { domain: 'truehost.com' },
    { domain: 'workspace.google.com' },
  ]) as any;
  assert.match(starter.value, /\$7 \[2\]/);

  // P06 recorded: two $159.99 paperwhite prices and a roundup citation collapse into
  // the Amazon page price, cited to the Amazon result, with the Kobo price kept once.
  const p06 = recorded('p06');
  const hits = [
    { domain: 'theslicklist.com', title: 'Best e-readers 2026', snippet: 'Kindle Paperwhite $159.99 and Kobo Clara BW $149.99' },
    { domain: 'amazon.com', url: 'https://www.amazon.com/dp/B0CFPJYX7P', title: 'Kindle Paperwhite (16GB)', snippet: 'Kindle Paperwhite $199.99' },
    { domain: 'kobo.com', url: 'https://www.kobo.com/clara-bw', title: 'Kobo Clara BW', snippet: 'Kobo Clara BW From $159.99' },
  ];
  const shown = settleCardPrices(recorded('p06').nodes.map((n) => n.node), p06.query, hits) as any[];
  const kindle = shown[0].children[0];
  assert.equal(kindle.label, 'Kindle Paperwhite');
  assert.match(kindle.value, /\$199\.99 \[2\]/);
  assert.equal(kindle.vendorTrue, true);
  const kobo = shown[0].children[1];
  assert.match(kobo.value, /\$159\.99 \[3\]/);
  assert.equal(kobo.value.includes('differs'), false);
  // One amount per product across the whole card.
  const amounts = dollars(shown);
  assert.equal(amounts.filter((d) => d.includes('199.99')).length, 1);
  assert.equal(amounts.filter((d) => d.includes('159.99')).length, 1);

  // P08-style: the iPad Air / Pro from-prices come from apple.com, and the table says so.
  const ipad = reconcileProductPrices([
    { type: 'table', columns: ['iPad Air', 'iPad Pro'], rows: [['From', '$599', '$1,100'], ['Chip', 'M3', 'M4']] },
  ], 'iPad Air vs iPad Pro for drawing, how much?', [
    { domain: 'apple.com', url: 'https://www.apple.com/ipad-air/', title: 'iPad Air', snippet: 'From $749' },
    { domain: 'apple.com', url: 'https://www.apple.com/ipad-pro/', title: 'iPad Pro', snippet: 'From $1,199' },
  ]) as any[];
  assert.deepEqual(ipad[0].rows[0], ['From', '$749 [1] (differs from vendor)', '$1,199 [2] (differs from vendor)']);
  assert.equal(ipad[0].priceRows[0].vendorTrue, true);
  assert.equal(ipad[0].priceRows[0].domain, 'apple.com');
  assert.equal(ipad[0].priceRows[0].note, 'differs from vendor');
});

test('one sentence naming both products keeps one vendor price for each', () => {
  const query = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
  const hits = [
    { domain: 'amazon.com', title: 'Kindle Paperwhite', snippet: 'Kindle Paperwhite $199.99' },
    { domain: 'kobo.com', title: 'Kobo Clara BW', snippet: 'Kobo Clara BW From $159.99' },
  ];
  const shown = reconcileProductPrices([
    { type: 'text', text: 'The Kindle Paperwhite is $159.99 and the Kobo Clara BW is $149.00, so the Kobo is cheaper.' },
    { type: 'text', text: 'The Bose QuietComfort is $299 and nothing else has a price here.' },
  ], query, hits) as any[];
  assert.equal(shown[0].text, 'The Kindle Paperwhite is $199.99 [1] (differs from vendor) and the Kobo Clara BW is $159.99 [2] (differs from vendor), so the Kobo is cheaper.');
  // No store price for that brand: the number goes, the sentence stays.
  assert.equal(shown[1].text, 'The Bose QuietComfort is and nothing else has a price here.');
});

test('with no store page, a product ask shows no guessed price', () => {
  const query = 'iPad Air vs iPad Pro for drawing, how much?';
  const shown = settleCardPrices([
    { type: 'tile', label: 'iPad Air', value: '$599' },
    { type: 'tile', label: 'iPad Pro', value: '$999' },
    { type: 'text', text: 'Prime Day has the Air at $649 and the Pro at $1,100.' },
  ], query);
  assert.equal(dollars(shown).length, 0);
  assert.match(JSON.stringify(shown), /Check store/);
});

test('an official-domain result is what a plan price cites', () => {
  const node = {
    type: 'stack',
    children: [
      { type: 'hero', value: '$7', caption: 'US list price [2]' },
      { type: 'pricing', plans: [{ name: 'Business Starter', prices: [{ amount: 7, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual' }] }] },
    ],
  };
  const stamped = stampOfficialPriceCite(node, 'Google Workspace Business Starter pricing', [
    { domain: 'workspace.google.com' },
    { domain: 'flamingo.run' },
  ]) as any;
  assert.match(stamped.children[0].value, /\$7 \[1\]/);
  assert.equal(stamped.children[1].plans[0].prices[0].source, 1);
});

test('the store lookup is one Serper call on the sites, inside the three-call cap', async () => {
  const literal = 'Kindle Paperwhite vs Kobo Clara BW, what do they cost?';
  const plan = searchPlan(literal, []);
  assert.equal(plan.more.length, 1);
  assert.ok(plan.more.length + 1 <= SEARCH_CALL_CAP);

  clearDeadEngines();
  const bodies: { q?: string }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('google.serper.dev')) {
      bodies.push(JSON.parse(String(init?.body)) as { q?: string });
      return Response.json({ organic: [{ title: 'Kindle Paperwhite', link: 'https://www.amazon.com/kindle-paperwhite', snippet: 'Kindle Paperwhite $199.99' }] });
    }
    return Response.json({});
  };
  try {
    const ledger = newLedger();
    await search({ q: literal, more: plan.more, vendorDomains: plan.vendorDomains, freshness: 'any', count: 8 }, { SERPER_API_KEY: 'test-serper-key', SERPER_DAILY_CAP: 'off' } as Env, { ledger, bypass: true });
    assert.ok(searchCalls(ledger) <= SEARCH_CALL_CAP);
    assert.equal(ledger.search.serper, plan.more.length + 1);
    // Exactly one call is site-restricted, and it is the store lookup.
    const restricted = bodies.filter((b) => /site:[\w.-]+/.test(b.q ?? ''));
    assert.equal(restricted.length, 1);
    assert.equal(restricted[0].q, plan.more[0]);
  } finally {
    globalThis.fetch = orig;
    clearDeadEngines();
  }
});
