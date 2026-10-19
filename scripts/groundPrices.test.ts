import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Grounding, groundNodes } from '../server/ground.ts';
import type { CardNode } from '../shared/card.ts';

test('an answer with no sources drops a price it made up, and keeps its reasoning numbers', () => {
  const g = new Grounding('Fitbit Edge vs Miband 10 price', true, '', true);
  const nodes: CardNode[] = [
    { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Fitbit Edge', value: '$299' }, { type: 'tile', label: 'Miband 10', value: '$199' }] },
    { type: 'text', text: 'A heat pump moves about 3 units of heat for each unit of power.' },
  ];
  const kept = groundNodes(nodes, g);
  assert.ok(!JSON.stringify(kept).includes('$299'));
  assert.ok(!JSON.stringify(kept).includes('$199'));
  assert.ok(JSON.stringify(kept).includes('3 units of heat'));
});

test('a price the conversation or the question stated stays, and a sourced chat answer keeps its own arithmetic', () => {
  const stated = new Grounding('split the $120 dinner bill three ways', true, '', true);
  assert.equal(stated.ok('$120'), true);
  assert.equal(stated.ok('$999'), false);
  const sourced = new Grounding('split the $120 dinner bill three ways', true, '', false);
  assert.equal(sourced.ok('$40 each'), true);
});

test('a figure rounded from a source figure is grounded, and a small whole number is not read as a rounding', () => {
  const g = new Grounding('Live price 82,432.99 USD; day range 81,942.16–82,682.14; 52-week range 57,747.77–116,273.31. Gas averages $4.33 a gallon; 12.4% of drivers.');
  assert.equal(g.ok('81,942 – 82,682 USD'), true);
  assert.equal(g.ok('57,748–116,273'), true);
  assert.equal(g.ok('$4.3'), true);
  assert.equal(g.ok('12 drivers'), false);
  assert.equal(g.ok('81,950'), false);
});

test('a figure written short is backed by the full figure, and one bad table cell is blanked, not its row', async () => {
  const g = new Grounding('Support sits at $80,500 and resistance at $87,000. Market cap 1,650,000,000,000 USD. The A19 chip, 3692 mAh.');
  assert.equal(g.ok('Pinned between $80.5K support and $87K resistance'), true);
  assert.equal(g.ok('Market cap $1.65T'), true);
  assert.equal(g.ok('$90K resistance'), false);
  const { groundNodes } = await import('../server/ground.ts');
  const [table] = groundNodes([{ type: 'table', columns: ['', 'iPhone 17', 'Pixel 10'], rows: [['Chip', 'A19', 'Tensor G5'], ['Battery', '3692 mAh', '4970 mAh']] }], g);
  assert.deepEqual(table?.type === 'table' ? table.rows : [], [['Chip', 'A19', ''], ['Battery', '3692 mAh', '']]);
});

test('a citation marker in a table cell is not a figure, and "cols" is a table header', async () => {
  const g = new Grounding('Roth IRA: no deduction now, tax-free growth. The 2026 limit is $7,500.');
  assert.equal(g.ok('No income tax deduction for contributions; growth is tax-free [1][11]'), true);
  const { sanitizeNodes } = await import('../server/sanitize.ts');
  const [table] = sanitizeNodes([{ type: 'table', cols: ['Feature', 'Roth IRA', 'Traditional IRA'], rows: [['Limit', '$7,500', '$7,500']] }], 0);
  assert.deepEqual(table?.type === 'table' ? table.columns : [], ['Feature', 'Roth IRA', 'Traditional IRA']);
});

test('a table keeps whole rows when most rows are backed, and blanks cells only to save most of it', async () => {
  const { groundNodes } = await import('../server/ground.ts');
  const g = new Grounding('Battery 3692 mAh and 4970 mAh. Weight 177 g and 204 g. Apple A19.');
  const [mostly] = groundNodes([{ type: 'table', columns: ['', 'A', 'B'], rows: [['Battery', '3692 mAh', '4970 mAh'], ['Weight', '177 g', '204 g'], ['Chip', 'A19', 'G5']] }], g);
  assert.deepEqual(mostly?.type === 'table' ? mostly.rows : [], [['Battery', '3692 mAh', '4970 mAh'], ['Weight', '177 g', '204 g']]);
});

test('a ratio worked out from two backed figures in the line is grounded', () => {
  const g = new Grounding('JWST has a 6.5 m segmented primary mirror. Hubble has a 2.4 m mirror.');
  assert.equal(g.ok("JWST's mirror is about 2.7 times wider than Hubble's — a 6.5 m segmented mirror against Hubble's 2.4 m."), true);
  assert.equal(g.ok("JWST's mirror is about 3.1 times wider than Hubble's — 6.5 m against 2.4 m."), false);
  assert.equal(g.ok("JWST's mirror is 3 times wider."), false);
});
