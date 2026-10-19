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
