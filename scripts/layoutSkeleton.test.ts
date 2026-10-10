import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutRepeatedLead } from '../shared/card.ts';
import { compareCount, patternSkeleton } from '../server/patterns.ts';

test('a title lead written twice is kept once', () => {
  assert.equal(
    withoutRepeatedLead('Which Is Better Value: Which Is Better Value: Renting vs Buying a Home'),
    'Which Is Better Value: Renting vs Buying a Home',
  );
  assert.equal(withoutRepeatedLead('Renting vs Buying'), 'Renting vs Buying');
});

test('a comparison placeholder has one tile per side and a table with a factor column', () => {
  assert.equal(compareCount('which is better value: renting vs buying a home'), 2);
  assert.equal(compareCount('tea vs coffee vs water'), 3);
  const body = patternSkeleton('compare', 'renting vs buying a home');
  assert.equal(body[0]?.type, 'grid');
  if (body[0]?.type === 'grid') assert.equal(body[0].children.length, 2);
  const table = body[1];
  assert.equal(table?.type, 'slot');
  if (table?.type === 'slot') {
    assert.equal(table.shape, 'table');
    assert.equal(table.cols, 3);
    assert.equal(table.rows, 4);
  }
  const three = patternSkeleton('compare', 'tea vs coffee vs water');
  const wide = three[1];
  if (wide?.type === 'slot') assert.equal(wide.cols, 4);
});
