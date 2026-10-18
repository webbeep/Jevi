import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breaksChain, chainStartIndex, introducedNames } from '../shared/chainSubject.ts';

test('a chain starts over when the question names a different place', () => {
  assert.deepEqual(introducedNames('When did North Pier open?'), ['North', 'Pier']);
  assert.equal(breaksChain('how tall is it', 'When did North Pier open? North Pier'), false);
  assert.equal(breaksChain('What is the viewing platform?', 'North Pier'), false);
  assert.equal(breaksChain('how many lakes are in Minnesota', 'who is Michael Jordan'), true);
  const turns = [
    { question: 'What time does a diner stop serving breakfast?', title: 'Diner hours' },
    { question: 'When did North Pier open to visitors?', title: 'North Pier' },
    { question: 'How tall is it?', title: 'North Pier height' },
    { question: 'What is the viewing platform?', title: '' },
  ];
  assert.equal(chainStartIndex(turns, 0), 0);
  assert.equal(chainStartIndex(turns, 3), 1);
  assert.equal(turns[chainStartIndex(turns, 3)]?.question, 'When did North Pier open to visitors?');
});
