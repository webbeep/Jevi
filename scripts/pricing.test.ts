import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { billingFromSources, billingLabel, billingNearAmount, inferSeats, isBareUnitHusk, isPlanQuery, monthlyTotal, priceAsOf, priceForBasis, publishedLabel, settleCardPrices, stripPricesDeep, stripStrayPrices, type Price } from '../shared/pricing.ts';

const WS = 'https://workspace.google.com/pricing';
const LINEAR = 'https://linear.app/pricing';
const FRESHDESK = 'https://www.freshworks.com/freshdesk/pricing/';
const ZENDESK = 'https://www.zendesk.com/pricing';
const ZAPIER = 'https://zapier.com/pricing';
const HURPAL = 'https://hurpal.com/hurpal-crm/';

function price(partial: Price): Price {
  return partial;
}

test('per-seat price times N seats', () => {
  const starter = price({ amount: 7, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: WS });
  const standard = price({ amount: 14, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: WS });
  const plus = price({ amount: 22, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: WS });
  assert.equal(monthlyTotal(starter, 4), 28);
  assert.equal(monthlyTotal(standard, 4), 56);
  assert.equal(monthlyTotal(plus, 4), 88);
  const linearBasic = price({ amount: 10, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: LINEAR });
  const linearBusiness = price({ amount: 16, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: LINEAR });
  assert.equal(monthlyTotal(linearBasic, 10), 100);
  assert.equal(monthlyTotal(linearBusiness, 10), 160);
  const freshdesk = price({ amount: 19, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: FRESHDESK });
  assert.equal(monthlyTotal(freshdesk, 1), 19);
});

test('minSeats floors the billed seat count', () => {
  const hurpal = price({ amount: 8, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', minSeats: 5, sourceUrl: HURPAL });
  assert.equal(monthlyTotal(hurpal, 2), 40);
  assert.equal(monthlyTotal(hurpal, 5), 40);
  assert.equal(monthlyTotal(hurpal, 6), 48);
});

test('flat tiers do not multiply by seats', () => {
  const zapier = price({ amount: 49, currency: 'USD', unit: 'flat', period: 'month', billing: 'annual', sourceUrl: ZAPIER });
  assert.equal(monthlyTotal(zapier, 1), 49);
  assert.equal(monthlyTotal(zapier, 10), 49);
  const hurpalFlat = price({ amount: 40, currency: 'USD', unit: 'flat', period: 'month', billing: 'monthly', minSeats: 5, sourceUrl: HURPAL });
  assert.equal(monthlyTotal(hurpalFlat, 5), 40);
  assert.equal(monthlyTotal(hurpalFlat, 3), 40);
  const wave = price({ amount: 190, currency: 'USD', unit: 'flat', period: 'year', billing: 'annual', sourceUrl: 'https://waveapps.com/pricing' });
  assert.equal(monthlyTotal(wave, 1), 15.83);
});

test('annual and monthly billing are separate prices', () => {
  const annual = price({ amount: 7, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: WS });
  const flexible = price({ amount: 8.4, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: WS });
  assert.equal(monthlyTotal(annual, 4), 28);
  assert.equal(monthlyTotal(flexible, 4), 33.6);
  const standardFlex = price({ amount: 16.8, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: WS });
  const plusFlex = price({ amount: 26.4, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: WS });
  assert.equal(monthlyTotal(standardFlex, 4), 67.2);
  assert.equal(monthlyTotal(plusFlex, 4), 105.6);
  const zendeskAnnual = price({ amount: 19, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: ZENDESK });
  const zendeskMonthly = price({ amount: 25, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: ZENDESK });
  assert.equal(monthlyTotal(zendeskAnnual, 1), 19);
  assert.equal(monthlyTotal(zendeskMonthly, 1), 25);
  const freshdeskMonthly = price({ amount: 23, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: FRESHDESK });
  assert.equal(monthlyTotal(freshdeskMonthly, 1), 23);
});

test('missing source yields a null total', () => {
  const invented = price({ amount: 7, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual' });
  assert.equal(monthlyTotal(invented, 4), null);
  const blank = price({ amount: 10, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: '   ' });
  assert.equal(monthlyTotal(blank, 10), null);
  const noAmount = price({ currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: LINEAR });
  assert.equal(monthlyTotal(noAmount, 10), null);
});

test('seat count comes from the question when one is stated', () => {
  assert.equal(inferSeats('which Google Workspace plan fits 4 people'), 4);
  assert.equal(inferSeats('Linear vs Jira for 10 engineers'), 10);
  assert.equal(inferSeats('best CRM for 5 people under $50/mo'), 5);
  assert.equal(inferSeats('Notion vs Coda for a 3-person agency'), 3);
  assert.equal(inferSeats('help desk tool under $20/seat'), undefined);
});

test('billed annually wins when the figure is quoted per month', () => {
  const page = 'Starter is $14 per user/month, billed annually. Flexible is $24 per user/month, billed monthly.';
  assert.equal(billingNearAmount(page, 14), 'annual');
  assert.equal(billingNearAmount(page, 24), 'monthly');
  assert.equal(billingNearAmount('Professional $49/mo', 49), undefined);
  assert.equal(billingNearAmount(page, 140), undefined);
});

test('billing basis is read from the cited page, not invented on the server', () => {
  const page = 'Starter is $14 per user/month, billed annually. Flexible is $24 per user/month, billed monthly.';
  const sources = [{ url: 'https://workspace.google.com/pricing', title: 'Pricing', snippet: page }];
  const annual = price({ amount: 14, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: WS });
  const flexible = price({ amount: 24, currency: 'USD', unit: 'seat', period: 'month', billing: 'annual', sourceUrl: WS });
  assert.equal(billingFromSources(annual, sources), 'annual');
  assert.equal(billingFromSources(flexible, sources), 'monthly');
  assert.equal(billingFromSources(annual, []), 'monthly');
});

test('sourced prices get a retrieval date when the page has none', () => {
  const label = priceAsOf(undefined, new Date('2026-10-07T15:00:00Z'));
  assert.equal(label, 'Oct 7, 2026');
  assert.equal(priceAsOf('2026-10-01', new Date('2026-10-07T15:00:00Z')), 'Oct 1, 2026');
});

test('plan questions drop dollar amounts outside the pricing node', () => {
  assert.equal(isPlanQuery('which Google Workspace plan fits 4 people'), true);
  assert.equal(isPlanQuery('Zapier vs Make for 2k tasks/mo'), true);
  assert.equal(isPlanQuery('best invoicing app for freelancers'), true);
  assert.equal(isPlanQuery('what year did the eiffel tower open'), false);
  assert.equal(stripStrayPrices('Starter is $14/user, under $50/mo'), 'Starter is /user, under $50/mo');
  const card = stripPricesDeep({
    type: 'stack',
    children: [
      { type: 'stat', label: 'Starter', value: '$70/mo' },
      { type: 'pricing', plans: [{ name: 'Starter', prices: [{ amount: 14 }] }] },
    ],
  });
  assert.equal(card.children[0].value, '—');
  assert.equal('unit' in card.children[0], false);
  assert.equal(card.children[1].plans[0].prices[0].amount, 14);
});

// Recorded zo2 @54aa917 streams from Product Insights' head-to-head (node events in arrival order).
type Recorded = { query: string; nodes: { index: number; node: any }[] };
const recorded = (name: string): Recorded => JSON.parse(readFileSync(new URL(`./fixtures/h2h-${name}-nodes.json`, import.meta.url), 'utf8'));

/** Replays node events the way useSession.placeNode does: raw nodes by index, prices re-settled over the whole card each time. */
function replay(rec: Recorded, upTo = rec.nodes.length) {
  const raw: any[] = [];
  let shown: any[] = [];
  for (const { index, node } of rec.nodes.slice(0, upTo)) {
    raw[index] = node;
    shown = settleCardPrices(raw, rec.query);
  }
  return shown;
}
const dollars = (v: unknown) => JSON.stringify(v).match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];

test('P05 recorded: pricing card keeps table prices, as-of and source, and the hero/stat repeats of those prices', () => {
  const rec = recorded('p05');
  assert.equal(isPlanQuery(rec.query), true);
  const shown = replay(rec);
  const [lead, explain, facts, table] = shown;
  // Pricing table: sourced amount, source link and as-of date all survive.
  assert.equal(table.type, 'pricing');
  const annual = priceForBasis(table.plans[0].prices, 'annual')!;
  assert.equal(publishedLabel(annual), '$7 per seat / month');
  assert.equal(billingLabel(annual.billing), 'billed annually');
  assert.equal(annual.sourceUrl, 'https://truehost.com/google-workspace-business-pricing/');
  assert.equal(annual.asOf, 'Sep 30, 2026');
  assert.equal(monthlyTotal(annual, table.seats), 35);
  assert.equal(publishedLabel(priceForBasis(table.plans[0].prices, 'monthly')!), '$8.40 per seat / month');
  // Before the fix these were stripped to "" and showed a bare "/user/mo".
  assert.equal(lead.children[0].type, 'hero');
  assert.equal(lead.children[0].value, '$7');
  assert.equal(lead.children[0].unit, '/user/mo');
  assert.equal(lead.children[1].children[0].value, '$8.40');
  assert.equal(explain.children[1].items[0].value, '$7.00 per user/month');
  assert.match(explain.children[2].text, /^\$7 is an introductory price/);
  assert.equal(facts.children[0].children[0].value, '$7');
  assert.equal(facts.children[0].children[1].value, '$8.40');
});

test('P05 recorded: true stray prices outside the pricing table are still removed', () => {
  const rec = recorded('p05');
  const stray = {
    type: 'stack',
    children: [
      { type: 'stat', label: 'Business Standard', value: '$14', unit: '/user/mo' },
      { type: 'text', text: 'Standard is $14 and Plus is $22, so 5 seats cost $35/mo on Starter. Keep it under $50.' },
    ],
  };
  const shown = settleCardPrices([...rec.nodes.map((n) => n.node), stray], rec.query);
  const settled = shown[shown.length - 1] as typeof stray;
  assert.equal(settled.children[0].value, '—');
  assert.equal('unit' in settled.children[0], false);
  assert.equal(settled.children[1].text, 'Standard is and Plus is, so 5 seats cost /mo on Starter. Keep it under $50.');
  // Every dollar amount left outside the pricing table is a sourced table price ($7, $8.40) or a budget.
  const outside = shown.filter((n: any) => n.type !== 'pricing');
  for (const d of dollars(outside)) assert.ok(['$7', '$7.00', '$8.40', '$50'].includes(d), `unexpected price outside the table: ${d}`);
});

test('P05 recorded: prices show while streaming and settle once the pricing table arrives', () => {
  const rec = recorded('p05');
  const pricingAt = rec.nodes.findIndex((n) => n.node.type === 'pricing');
  const early = replay(rec, pricingAt);
  assert.equal(early[0].children[0].value, '$7');
  assert.equal(replay(rec)[0].children[0].value, '$7');
});

test('P10 recorded: a product ask with no known store keeps its prices; P06 drops roundup prices until the store page is in hand', () => {
  const p10 = recorded('p10');
  const raw10: any[] = [];
  for (const { index, node } of p10.nodes) raw10[index] = node;
  assert.equal(raw10.some((n) => n?.type === 'pricing'), false);
  assert.deepEqual(settleCardPrices(raw10, p10.query), raw10);
  const p06 = recorded('p06');
  const raw6: any[] = [];
  for (const { index, node } of p06.nodes) raw6[index] = node;
  const shown = settleCardPrices(raw6, p06.query);
  assert.equal(dollars(shown).length, 0);
  assert.match(JSON.stringify(shown), /Check store/);
});

test('an unsourced pricing row does not license prices elsewhere', () => {
  const nodes = [
    { type: 'hero', value: '$9', unit: '/mo', label: 'Starter' },
    { type: 'pricing', plans: [{ name: 'Starter', prices: [{ amount: 9, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly' }] }] },
    { type: 'pricing', plans: [{ name: 'Pro', prices: [{ amount: 20, currency: 'USD', unit: 'seat', period: 'month', billing: 'monthly', sourceUrl: 'https://example.com/pricing' }] }] },
  ];
  const shown = settleCardPrices(nodes, 'Example plans pricing') as any[];
  assert.equal(shown[0].value, '—');
  assert.deepEqual(shown[1], nodes[1]);
});

test('stray-price matching reads whole amounts', () => {
  assert.equal(stripStrayPrices('Pro is $1299.99 today', [1299.99]), 'Pro is $1299.99 today');
  assert.equal(stripStrayPrices('Pro is $1,299.99 today', [1299.99]), 'Pro is $1,299.99 today');
  assert.equal(stripStrayPrices('Pro is $1299.99 today'), 'Pro is today');
  assert.equal(stripStrayPrices('No prices here.'), 'No prices here.');
});

test('list-row meta husks become an em dash (QA q6/q8), while sourced metas and headlines stay', () => {
  assert.equal(isBareUnitHusk('/mo'), true);
  assert.equal(isBareUnitHusk('–/mo'), true);
  assert.equal(isBareUnitHusk('-/yr'), true);
  assert.equal(isBareUnitHusk('$/seat'), true);
  assert.equal(isBareUnitHusk('/user/mo'), true);
  assert.equal(isBareUnitHusk('5 seats cost /mo'), false);
  assert.equal(isBareUnitHusk('$43/mo'), false);

  const FB = 'https://smarttoolspick.com/freshbooks-pricing/';
  const nodes = [
    { type: 'hero', value: '$43', unit: '/mo', label: 'FreshBooks Plus' },
    {
      type: 'list',
      style: 'bullet',
      items: [
        { text: 'FreshBooks Plus — Best overall', meta: '$43/mo' },
        { text: 'Bonsai Essentials — Best all-in-one', meta: '$25/mo' },
        { text: 'Xero — Best for multi-currency', meta: '$25–$90/mo' },
        { text: 'QuickBooks Online Simple Start — Best accountant-ready', meta: '$38/mo' },
        { text: 'Help Scout — Shared inbox', meta: '$25/mo' },
      ],
    },
    {
      type: 'keyvalue',
      items: [{ label: 'Bonsai', value: '$25/mo' }, { label: 'FreshBooks', value: '$43/mo' }],
    },
    {
      type: 'pricing',
      seats: 1,
      plans: [{
        name: 'Plus',
        prices: [{ amount: 43, currency: 'USD', unit: 'flat', period: 'month', billing: 'monthly', sourceUrl: FB, asOf: 'Aug 16, 2026' }],
      }],
    },
  ];
  const shown = settleCardPrices(nodes, 'best invoicing app for freelancers') as any[];
  assert.equal(shown[0].value, '$43');
  assert.equal(shown[0].unit, '/mo');
  const metas = shown[1].items.map((i: any) => i.meta);
  assert.deepEqual(metas, ['$43/mo', '—', '—', '—', '—']);
  assert.equal(shown[2].items[0].value, '—');
  assert.equal(shown[2].items[1].value, '$43/mo');
  assert.deepEqual(shown[3], nodes[3]);
});
