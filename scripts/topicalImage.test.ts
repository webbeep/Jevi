import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topicalImage } from '../server/search.ts';

test('a library picture must share a word with the question', () => {
  assert.equal(topicalImage('how to make sourdough starter', 'The-Transformer-model-architecture.png'), false);
  assert.equal(topicalImage('NBA scores tonight', 'Famitsu svg WIKI1'), false);
  assert.equal(topicalImage('how to make sourdough starter', 'Sourdough starter in a jar'), true);
  assert.equal(topicalImage('best coffee shops in Seattle', 'Seattle skyline at dusk'), true);
  assert.equal(topicalImage('NBA scores tonight', 'NBA game at Madison Square Garden'), true);
});
