import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { tickerBody, tickerRows } from '../shared/tickerNotes.ts';
import { collapseReadings } from '../server/readings.ts';
import { sayOnce } from '../server/sourceQuality.ts';

const text = (t: string): CardNode => ({ type: 'text', text: t });
const REPEAT = 'Let the apple pie cool for two full hours before slicing it.';

test('a repeated line stays in the component that was shown first', () => {
  const nodes = [text(`Bake it at 425F until the crust turns deep golden brown. ${REPEAT}`), text(REPEAT)];
  // Top to bottom, the lower component loses the line.
  assert.deepEqual(sayOnce(nodes), [nodes[0], undefined]);
  // The lower one was on screen first: it keeps the line, and the late arrival above drops it.
  assert.deepEqual(sayOnce(nodes, '', [1, 0]), [text('Bake it at 425F until the crust turns deep golden brown.'), nodes[1]]);
});

test('a repeated reading stays in the tile shown first, and the hero is always the reference', () => {
  const tile = (label: string, value: string): CardNode => ({ type: 'tile', label, value });
  const first: CardNode = { type: 'grid', cols: 2, children: [tile('Humidity', '62%'), tile('Wind', '9 mph')] };
  const later: CardNode = { type: 'grid', cols: 2, children: [tile('Humidity', '62%'), tile('UV index', '3')] };
  const [a, b] = collapseReadings([first, later], [0, 1]);
  assert.deepEqual(a, first);
  assert.deepEqual(b, { ...later, children: [tile('UV index', '3')] });
  const [c, d] = collapseReadings([first, later], [1, 0]);
  assert.deepEqual(c, { ...first, children: [tile('Wind', '9 mph')] });
  assert.deepEqual(d, later);
});

test('rows keep their keys when the ticker strips a chart', () => {
  const ticker: CardNode = { type: 'ticker', symbol: 'RDW', name: 'Redwire', price: 10, currency: 'USD', change: 0.1, changePct: 1, points: [] } as unknown as CardNode;
  const chart: CardNode = { type: 'chart', kind: 'line', data: [{ label: 'a', value: 1 }] } as unknown as CardNode;
  const rows = tickerRows([{ node: ticker, key: 's0' }, { node: chart, key: 's1' }, { node: text('Why it moved.'), key: 's2' }]);
  assert.deepEqual(rows.map((row) => row.key), ['s0', 's2']);
  assert.deepEqual(tickerBody([ticker, chart, text('Why it moved.')]), rows.map((row) => row.node));
  const plain = [{ node: text('a'), key: 'x' }];
  assert.equal(tickerRows(plain), plain);
});
