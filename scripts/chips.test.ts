import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choicesIn, distinctActions, repeatsCallout, subjectWords } from '../server/chips.ts';
import type { CardNode } from '../shared/card.ts';

const choices: Extract<CardNode, { type: 'choices' }> = {
  type: 'choices',
  options: [
    { label: 'Rugby career', prompt: 'Ricky Cheuk rugby career' },
    { label: 'Restaurants', prompt: 'Ricky Cheuk restaurants' },
    { label: 'Hall of Fame', prompt: 'Ricky Cheuk Hall of Fame' },
  ],
};

test('actions that repeat a choices option are dropped', () => {
  const actions: Extract<CardNode, { type: 'actions' }> = {
    type: 'actions',
    items: [
      { label: 'Rugby highlights', query: 'Ricky Cheuk rugby highlights' },
      { label: 'His restaurants', query: 'Ricky Cheuk restaurants' },
      { label: 'Hall of Fame', query: 'Ricky Cheuk Hall of Fame' },
      { label: 'Ricky Cheuk interviews', query: 'Ricky Cheuk interview' },
    ],
  };
  const kept = distinctActions(actions, [choices], subjectWords('who is Ricky Cheuk'));
  assert.deepEqual(kept?.items.map((i) => i.label), ['Ricky Cheuk interviews']);
});

test('all-duplicate actions leave nothing, distinct ones stay untouched', () => {
  const dupes: Extract<CardNode, { type: 'actions' }> = { type: 'actions', items: [{ label: 'Restaurants', query: 'x' }] };
  assert.equal(distinctActions(dupes, [choices], new Set()), undefined);
  const fresh: Extract<CardNode, { type: 'actions' }> = { type: 'actions', items: [{ label: 'Early life', query: 'x' }, { label: 'Family', query: 'y' }] };
  assert.equal(distinctActions(fresh, [choices], new Set()), fresh);
});

test('choices nested in layout nodes are found', () => {
  const nodes: CardNode[] = [{ type: 'section', children: [{ type: 'tabs', tabs: [{ label: 'a', children: [choices] }] }] }];
  assert.equal(choicesIn(nodes).length, 1);
});

test('a callout repeating one already on the card is dropped, a different one stays', () => {
  const shown: CardNode[] = [{ type: 'stack', children: [{ type: 'callout', tone: 'warning', title: 'No recent news', text: 'No dated news about Jessica Chen at NYU and cryptocurrency. The only relevant result is an undated cryptography paper [1].' }] }];
  assert.equal(repeatsCallout({ type: 'callout', tone: 'warning', title: 'No recent news', text: 'The only relevant result [1] is an undated cryptography paper, not a news story.' }, shown), true);
  assert.equal(repeatsCallout({ type: 'callout', tone: 'info', text: 'Proof-of-work grinding makes Fiat–Shamir transforms harder to attack.' }, shown), false);
});
