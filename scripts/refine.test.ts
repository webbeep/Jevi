import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constrainNode, isKeepOnly, keptBody } from '../server/refine.ts';
import type { CardNode } from '../shared/card.ts';

test('keep only Oregon schools drops the other school and does not copy Oregon State into graduate', () => {
  assert.equal(isKeepOnly('keep only Oregon schools'), true);
  assert.equal(isKeepOnly('what did he study'), false);
  const card: CardNode = {
    type: 'profile',
    name: 'Jensen Huang',
    facts: [
      { label: 'Born', value: '1963' },
      { label: 'Undergraduate', value: 'Oregon State University' },
      { label: 'Graduate', value: 'Oregon State University' },
    ],
  };
  const corpus = '{"label":"Undergraduate","value":"Oregon State University"},{"label":"Graduate","value":"Stanford University"} He earned a bachelor\'s degree from Oregon State and a master\'s from Stanford.';
  const next = constrainNode(card, 'keep only Oregon schools', corpus);
  const facts = next?.type === 'profile' ? next.facts ?? [] : [];
  assert.deepEqual(facts.map((fact) => fact.label), ['Born', 'Undergraduate']);
  assert.equal(facts[1]?.value, 'Oregon State University');
});

test('keep only keeps the citations from the card it filters', () => {
  const profile: CardNode = {
    type: 'profile',
    name: 'Jensen Huang',
    facts: [
      { label: 'Undergraduate', value: 'Oregon State University' },
      { label: 'Graduate', value: 'Stanford University' },
    ],
  };
  const corpus = 'He earned a bachelor\'s degree from Oregon State and a master\'s from Stanford.';
  const next = keptBody([profile, { type: 'citations', refs: [1, 2] }], 'keep only Oregon schools', corpus);
  assert.equal(next.some((node) => node.type === 'list' || node.type === 'profile'), true);
  const cites = next.find((node) => node.type === 'citations');
  assert.ok(cites && cites.type === 'citations' && cites.refs.length > 0);
});
