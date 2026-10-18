import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { objectContext, sameObject } from '../shared/objects.ts';
import { unblendObjects } from '../server/objectFacts.ts';

test('a different number is a different object, and each object keeps its own id', () => {
  assert.equal(sameObject('Contax T2', 'Contax T3'), false);
  assert.equal(sameObject('Contax T2', 'The Contax T2'), true);
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
