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
