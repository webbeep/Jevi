import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasArrivedSources, showWaitingLayout } from '../src/card/waitingLayout.ts';

const waiting = {
  filling: true,
  hasResult: false,
  answerStarted: false,
  layoutCount: 3,
};

test('the empty layout stays off the source trail until a component has data', () => {
  assert.equal(showWaitingLayout(waiting), false);
  assert.equal(showWaitingLayout({ ...waiting, answerStarted: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, layoutCount: 0 }), false);
});

test('an empty search is not a source on the card', () => {
  assert.equal(hasArrivedSources({ results: [] }, []), false);
  assert.equal(hasArrivedSources(undefined, undefined), false);
  assert.equal(hasArrivedSources({ results: [{}] }), true);
  assert.equal(hasArrivedSources(undefined, [{}]), true);
});

test('a finished card does not fall back to the placeholder when the live stream is cleared', () => {
  assert.equal(showWaitingLayout({ ...waiting, filling: false, hasResult: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, hasResult: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, filling: false }), false);
});
