import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { GAP_MARK, keptCardNodes } from '../shared/gap.ts';
import { cardGaps, citeForGap, gapSearchQuery, markGap, settleGap } from '../server/gapFill.ts';

const table: CardNode = {
  type: 'table',
  columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
  rows: [
    ['Display', '1.34 AMOLED [2]', 'Vibrant, glanceable'],
    ['Weight', '—', '15.95 g [4]'],
    ['Price', '$179.99 [1]', '$34.99 [3]'],
  ],
};

test('a follow-up keeps cited components and adds one placeholder for the new fact', () => {
  const kept = keptCardNodes([
    { type: 'tile', label: 'Harbor Slate', value: '$179.99', source: 1 },
    { type: 'tile', label: 'Northwatch 2', value: '$34.99 [2]' },
    { type: 'actions', items: [] },
    { type: 'text', text: 'A slogan with no source.' },
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0]?.type === 'tile' ? kept[0].label : '', 'Harbor Slate');
  assert.equal(kept[1]?.type === 'tile' ? kept[1].value : '', '$34.99 [2]');
});

test('a blank cell is the only placeholder, and a cited price stays', () => {
  const gaps = cardGaps(new Map([[0, table]]));
  assert.deepEqual(gaps.map((gap) => gap.label), ['Weight', 'Display']);
  assert.equal(gaps[0]?.missing, true);
  const marked = gaps.reduce((node, gap) => markGap(node, gap), table);
  assert.equal(marked.type === 'table' ? marked.rows[1]?.[1] : '', GAP_MARK);
  assert.equal(marked.type === 'table' ? marked.rows[0]?.[2] : '', GAP_MARK);
  assert.equal(marked.type === 'table' ? marked.rows[2]?.[1] : '', '$179.99 [1]');
  assert.equal(marked.type === 'table' ? marked.rows[0]?.[1] : '', '1.34 AMOLED [2]');
  const settled = settleGap(table, gaps[0]!, '17.7 g [5]');
  assert.equal(settled.type === 'table' ? settled.rows[1]?.[1] : '', '17.7 g [5]');
  assert.equal(settled.type === 'table' ? settled.rows[2]?.[1] : '', '$179.99 [1]');
});

test('a measured spec is not replaced when the new text has no measurement', () => {
  const gap = {
    index: 0,
    path: [{ kind: 'cell' as const, row: 0, column: 1 }],
    label: 'Display',
    side: 'Harbor Slate',
    previous: '1.34 AMOLED',
    missing: false,
    whole: false,
  };
  const kept = settleGap(table, gap, 'Vibrant, glanceable [1]');
  assert.equal(kept.type === 'table' ? kept.rows[0]?.[1] : '', '1.34 AMOLED');
  const cited = citeForGap(gap, [{ title: 'Harbor Slate specs', snippet: 'The display is a 1.34-inch AMOLED.' }]);
  assert.equal(cited, '1.34 AMOLED [1]');
});

test('a slogan takes a number from the same clause, and the search names the missing row', () => {
  const gap = {
    index: 0,
    path: [{ kind: 'cell' as const, row: 0, column: 2 }],
    label: 'Display',
    side: 'Northwatch 2',
    previous: 'Vibrant, glanceable',
    missing: false,
    whole: false,
  };
  const cited = citeForGap(gap, [{
    title: 'Northwatch 2 specs',
    snippet: 'The Northwatch 2 has a 7-day battery and a 1.72-inch display.',
  }]);
  assert.equal(cited, '1.72-inch [1]');
  const missed = citeForGap(gap, [{
    title: 'Northwatch 2 specs',
    snippet: 'The Northwatch 2 has a 7-day battery and a glanceable display.',
  }]);
  assert.equal(missed, undefined);
  assert.match(gapSearchQuery('Harbor Slate vs Northwatch 2', [gap]), /Display/);
});
