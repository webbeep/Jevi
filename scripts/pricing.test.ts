import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingFromSources, billingNearAmount, inferSeats, isPlanQuery, monthlyTotal, priceAsOf, stripPricesDeep, stripStrayPrices, type Price } from '../shared/pricing.ts';

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
  assert.equal(card.children[0].value, '/mo');
  assert.equal(card.children[1].plans[0].prices[0].amount, 14);
});
