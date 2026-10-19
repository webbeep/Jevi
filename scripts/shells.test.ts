import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutShells } from '../shared/shells.ts';
import { GAP_MARK } from '../shared/gap.ts';

test('a table row with no values left is dropped, and a single missing cell reads as a dash', () => {
  const table = { type: 'table' as const, columns: ['', 'iPhone 17', 'Pixel 10'], rows: [['Display', '', '6.3-inch'], ['Cheapest in 50 metros', '', ' '], ['Storage', GAP_MARK, '']] };
  assert.deepEqual(withoutShells(table), { ...table, rows: [['Display', '—', '6.3-inch'], ['Storage', GAP_MARK, '—']] });
  assert.equal(withoutShells({ type: 'table', columns: ['', 'A'], rows: [['Price', '']] }), undefined);
});

test('a citation-only sentence, an empty verdict and an empty key are not shown', () => {
  assert.equal(withoutShells({ type: 'callout', title: 'Verdict', text: '[2][8][10][11]' }), undefined);
  assert.equal(withoutShells({ type: 'text', text: ' [8] ' }), undefined);
  assert.deepEqual(withoutShells({ type: 'keyvalue', items: [{ label: 'RSI14', value: '' }, { label: 'Close', value: '$12.40' }] }), { type: 'keyvalue', items: [{ label: 'Close', value: '$12.40' }] });
  assert.deepEqual(withoutShells({ type: 'tile', label: 'iPhone 17', value: '$799', sub: '″ · · ' }), { type: 'tile', label: 'iPhone 17', value: '$799', sub: undefined });
  const kept = { type: 'stack' as const, children: [{ type: 'text' as const, text: 'Feed it daily [3].' }] };
  assert.equal(withoutShells(kept), kept);
  assert.deepEqual(withoutShells({ type: 'stack', children: [{ type: 'text', text: 'Feed it daily.' }, { type: 'callout', text: '[8]' }] }), { type: 'stack', children: [{ type: 'text', text: 'Feed it daily.' }] });
});

test('a tile or key that only says there is no value is not shown', () => {
  assert.equal(withoutShells({ type: 'tile', label: 'Lakers vs Warriors', value: 'None yet' }), undefined);
  assert.deepEqual(withoutShells({ type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Final', value: 'Unavailable' }, { type: 'tile', label: 'Next game', value: 'Oct 21' }] }), { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Next game', value: 'Oct 21' }] });
  assert.deepEqual(withoutShells({ type: 'keyvalue', items: [{ label: 'Weight', value: 'N/A' }, { label: 'Display', value: '1.34 in' }] }), { type: 'keyvalue', items: [{ label: 'Display', value: '1.34 in' }] });
  const named = { type: 'tile' as const, label: 'Mi Band 10' };
  assert.equal(withoutShells(named), named);
});
