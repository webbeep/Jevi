import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withinFx, type FxQuote } from '../shared/fxCard.ts';
import type { CardNode } from '../shared/card.ts';

const fx: FxQuote = { base: 'USD', quote: 'JPY', price: 158.02 };

test('a dollar-yen card drops the inverse rate, other currencies and a second rate for the pair', () => {
  const grid: CardNode = { type: 'grid', cols: 2, children: [
    { type: 'tile', label: 'Spot fix', value: '158.34' },
    { type: 'tile', label: '1 JPY in USD', value: '0.0063285' },
    { type: 'tile', label: '1 GBP', value: '210.1047 JPY' },
    { type: 'tile', label: 'Day range', value: '157.70–158.40' },
    { type: 'tile', label: '5 USD', value: '790 JPY' },
  ] };
  const kept = withinFx(grid, fx);
  assert.deepEqual(kept && kept.type === 'grid' ? kept.children.map((c) => (c.type === 'tile' ? c.label : '')) : [], ['Day range', '5 USD']);
  const text = withinFx({ type: 'text', text: 'One dollar buys about ¥158.02 today [4]. The yen is worth $0.0063 [5].' }, fx);
  assert.deepEqual(text, { type: 'text', text: 'One dollar buys about ¥158.02 today [4].' });
  const hero: CardNode = { type: 'hero', value: '158.02', unit: 'JPY', label: '1 US dollar' };
  assert.equal(withinFx(hero, fx), hero);
});

test('a live-quote card drops a different price right now and a different change today, and keeps history', async () => {
  const { withinQuote } = await import('../shared/fxCard.ts');
  const btc = { price: 82423, pct: 0.48 };
  assert.equal(withinQuote({ type: 'text', text: 'BTC is trading around $81,184 [3].' }, btc), undefined);
  assert.equal(withinQuote({ type: 'tile', label: 'Today', value: '+0.84%', sub: 'over the last day' }, btc), undefined);
  const kept: CardNode = { type: 'tile', label: '52-week high', value: '$126,198' };
  assert.equal(withinQuote(kept, btc), kept);
  const rdw = { price: 8.39, pct: -5.84 };
  assert.equal(withinQuote({ type: 'tile', label: 'Oct 18', value: 'Stock hit $14.19 Monday', sub: 'before falling to $13.58' }, rdw), undefined);
  const closed: CardNode = { type: 'text', text: 'It closed at $8.91 on Friday [2].' };
  assert.equal(withinQuote(closed, rdw), closed);
  const why: CardNode = { type: 'list', items: [{ text: 'Shares fell 5.84% today after an analyst downgrade [4].' }] };
  assert.equal(withinQuote(why, rdw), why);
});

test('a 24-hour move and a level the price is not under are checked against the widget', async () => {
  const { withinQuote } = await import('../shared/fxCard.ts');
  const btc = { price: 82581, pct: 0.69 };
  assert.equal(withinQuote({ type: 'text', text: 'BTC fell 0.2% over 24 hours [3].' }, btc), undefined);
  assert.equal(withinQuote({ type: 'list', items: [{ text: 'Below the 200-day moving average at 82,364.04, which reads as a Sell [5].' }] }, btc), undefined);
  const support: CardNode = { type: 'list', items: [{ text: 'Holding above the $80,000 support level [2].' }] };
  assert.equal(withinQuote(support, btc), support);
});

test('a weather card keeps the official high for today and other days\' readings', async () => {
  const { forecastHigh, withinForecast } = await import('../shared/weatherCard.ts');
  const forecast = forecastHigh([{ engines: ['nws'], content: 'Official National Weather Service forecast.\nTonight: Mostly clear, with a low around 47.\nMonday: Sunny, with a high near 65.\nTuesday: Partly sunny, with a high near 65.' }]);
  assert.deepEqual(forecast, { day: 'Monday', high: 65 });
  assert.equal(withinForecast({ type: 'hero', value: '72', unit: '°F', label: 'High today', caption: 'Storms expected late Friday' }, forecast!), undefined);
  const nws: CardNode = { type: 'hero', value: '65', unit: '°F', label: 'High today', caption: 'Sunny' };
  assert.equal(withinForecast(nws, forecast!), nws);
  const later: CardNode = { type: 'tile', label: 'Wednesday', value: '62°', sub: 'High' };
  assert.equal(withinForecast(later, forecast!), later);
});
