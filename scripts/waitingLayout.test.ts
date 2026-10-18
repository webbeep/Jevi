import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasArrivedSources, showWaitingLayout } from '../src/card/waitingLayout.ts';

const waiting = {
  filling: true,
  hasResult: false,
  answerStarted: false,
  layoutCount: 3,
  needsSources: true,
  sourcesReady: true,
};

test('the plan skeleton shows once sources have settled and the answer has not started', () => {
  assert.equal(showWaitingLayout(waiting), true);
  assert.equal(showWaitingLayout({ ...waiting, sourcesReady: false }), false);
  assert.equal(showWaitingLayout({ ...waiting, needsSources: false, sourcesReady: false }), true);
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
  assert.equal(showWaitingLayout({ ...waiting, answerStarted: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, filling: false }), false);
});
