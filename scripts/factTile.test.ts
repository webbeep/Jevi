import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factTileLabel } from '../shared/factTile.ts';

test('podcast fact labels are not pictures', () => {
  assert.equal(factTileLabel('Host'), true);
  assert.equal(factTileLabel('Co-hosts'), true);
  assert.equal(factTileLabel('Co hosts'), true);
  assert.equal(factTileLabel('New episodes'), true);
  assert.equal(factTileLabel('Network'), true);
  assert.equal(factTileLabel('Network:'), true);
  assert.equal(factTileLabel('Rating'), true);
  assert.equal(factTileLabel('Marques Brownlee'), false);
  assert.equal(factTileLabel('vs Suns'), false);
  assert.equal(factTileLabel('Vox Media'), false);
});
