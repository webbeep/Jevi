import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitContext } from '../shared/contextFit.ts';
import { cardPlainText } from '../shared/digest.ts';

test('a long conversation keeps the card being acted on and drops the oldest turns first', () => {
  const earlier = Array.from({ length: 7 }, (_, i) => `- Q: question ${i} → ${'x'.repeat(240)}`);
  const text = [
    'This turn is about Pixel 10.',
    'Topic: iphone 17 vs pixel 10',
    'Earlier turns, oldest first:',
    ...earlier,
    `Card they are acting on (Q: which one has better battery life?): Battery: 3692 mAh vs 4970 mAh ${'y'.repeat(900)}`,
    'Objects on screen: iPhone 17, Pixel 10',
  ].join('\n');
  const fitted = fitContext(text, 1600);
  assert.ok(fitted.length <= 1600);
  assert.match(fitted, /^This turn is about Pixel 10\./);
  assert.match(fitted, /Topic: iphone 17 vs pixel 10/);
  assert.match(fitted, /Card they are acting on \(Q: which one has better battery life\?\): Battery: 3692 mAh vs 4970 mAh/);
  assert.match(fitted, /Objects on screen: iPhone 17, Pixel 10/);
  assert.match(fitted, /question 6/);
  assert.doesNotMatch(fitted, /question 0/);
  assert.equal(fitContext('short', 100), 'short');
});

test('the judge reads a card\'s table rows, not a summary of its columns', () => {
  const text = cardPlainText({ title: 'iPhone 17 vs Pixel 10', body: [{ type: 'table', columns: ['', 'iPhone 17', 'Pixel 10'], rows: [['Battery', '3692 mAh', '4970 mAh']] }, { type: 'actions', items: [{ label: 'Compare cameras', query: 'iphone 17 camera', kind: 'search' }] }] });
  assert.match(text, /Battery · 3692 mAh · 4970 mAh/);
  assert.doesNotMatch(text, /Compare cameras/);
});
