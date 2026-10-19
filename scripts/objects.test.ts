import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { cleanSideName, objectContext, sameObject } from '../shared/objects.ts';
import { unblendObjects } from '../server/objectFacts.ts';

test('a different number is a different object, and each object keeps its own id', () => {
  assert.equal(sameObject('Contax T2', 'Contax T3'), false);
  assert.equal(sameObject('Contax T2', 'The Contax T2'), true);
  assert.equal(cleanSideName('Nikon Zf What Is the Battery Life of Each Camera?'), 'Nikon Zf');
  assert.equal(cleanSideName('Add the Sony a7C II'), 'Sony a7C II');
  const context = objectContext([{
    body: [{
      type: 'table',
      columns: ['Factor', 'Contax T2', 'Minolta TC-1'],
      rows: [['Price', '$400 [1]', '£1000 [2]'], ['Lens', '38mm [1]', '28mm [2]']],
    }],
  }]);
  assert.match(context, /o1 Contax T2/);
  assert.match(context, /o2 Minolta TC-1/);
  assert.match(context, /\$400 \[1\]/);
  assert.match(context, /£1000 \[2\]/);
});

test('a new object does not keep another object\'s price or photo', () => {
  const prior: CardNode[] = [{
    type: 'tile',
    label: 'Contax T2',
    value: '$400 [1]',
    imageSrc: 'https://img.example/contax.jpg',
  }];
  const next = new Map<number, CardNode>([[0, {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Contax T2', value: '$400 [1]', imageSrc: 'https://img.example/contax.jpg' },
      { type: 'tile', label: 'Olympus XA', value: '$400 [1]', imageSrc: 'https://img.example/contax.jpg' },
    ],
  }]]);
  const sources = [{ title: 'Contax T2 for $400', snippet: 'The Contax T2 costs $400.' }];
  const patches = unblendObjects(next, prior, sources);
  const grid = patches?.find((patch) => patch.index === 0)?.node;
  assert.equal(grid?.type, 'grid');
  if (grid?.type !== 'grid') return;
  const xa = grid.children.find((node) => node.type === 'tile' && node.label === 'Olympus XA');
  const contax = grid.children.find((node) => node.type === 'tile' && node.label === 'Contax T2');
  assert.equal(xa?.type === 'tile' ? xa.value : '', undefined);
  assert.equal(xa?.type === 'tile' ? xa.imageSrc : '', undefined);
  assert.equal(contax?.type === 'tile' ? contax.value : '', '$400 [1]');
  assert.equal(contax?.type === 'tile' ? contax.imageSrc : '', 'https://img.example/contax.jpg');
});

test('a number a source states for the new object stays', () => {
  const prior: CardNode[] = [{ type: 'tile', label: 'Contax T2', value: '295 g [1]' }];
  const next = new Map<number, CardNode>([[0, {
    type: 'table',
    columns: ['Factor', 'Contax T2', 'Olympus XA'],
    rows: [['Weight', '295 g [1]', '225 g [2]']],
  }]]);
  const patches = unblendObjects(next, prior, [
    { title: 'Contax T2', snippet: 'The Contax T2 weighs 295 g.' },
    { title: 'Olympus XA', snippet: 'The Olympus XA weighs 225 g.' },
  ]);
  assert.equal(patches, undefined);
});

test('a figure a source states for both objects together stays on each', () => {
  const next = new Map<number, CardNode>([[0, {
    type: 'table',
    columns: ['Factor', 'Roth IRA', 'Traditional IRA'],
    rows: [['2026 contribution limit', '$7,500 under 50; $8,600 age 50+ [1]', '$7,500 under 50; $8,600 age 50+ [1]']],
  }]]);
  const shared = [{ title: 'IRA contribution limits', snippet: "For 2026, the total contributions you make to all of your traditional IRAs and Roth IRAs can't be more than $7,500 ($8,600 if you're age 50 or older)." }];
  assert.equal(unblendObjects(next, [], shared), undefined);
  // A sentence that gives each object its own figure does not lend one to the other.
  const own = [{ title: 'IRA limits', snippet: 'A Roth IRA allows $7,500 under 50 and $8,600 at age 50+, while a SEP IRA allows far more.' }];
  const patches = unblendObjects(next, [], own);
  const table = patches?.[0]?.node;
  assert.equal(table?.type === 'table' ? table.rows[0]?.[2] : 'kept', '');
});

test('a thousands figure on one object is not foreign to another because both end in 000', () => {
  const next = new Map<number, CardNode>([[0, {
    type: 'table',
    columns: ['Factor', 'Roth IRA', 'Traditional IRA'],
    rows: [['Income limits', 'Full contribution under $153,000 single [1]', 'Deduction phases out $81,000–$91,000 single [2]']],
  }]]);
  assert.equal(unblendObjects(next, [], [{ title: 'IRA limits', snippet: 'Roth phase-out starts at $153,000.' }]), undefined);
});

test('a sentence that names only this object states its figure across a comma', () => {
  const next = new Map<number, CardNode>([[0, {
    type: 'table',
    columns: ['Factor', 'Roth IRA', 'Traditional IRA'],
    rows: [
      ['Income limits', 'Full contribution under $153,000 single [1]', 'No income limit to contribute [2]'],
      ['Note', 'Phase-out applies [1]', 'Deduction may phase out above $153,000 for some filers [2]'],
    ],
  }]]);
  const sources = [
    { title: 'Roth IRA limits', snippet: 'To contribute the full amount to a Roth IRA, single filers must have MAGI under $153,000.' },
    { title: 'Traditional IRA', snippet: 'Anyone with earned income can contribute to a traditional IRA, and the deduction may phase out above $153,000 for some filers.' },
  ];
  assert.equal(unblendObjects(next, [], sources), undefined);
});
