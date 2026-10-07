import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferSeats, monthlyTotal, type Price } from '../shared/pricing.ts';

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
