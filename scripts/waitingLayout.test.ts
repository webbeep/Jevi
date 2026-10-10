import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showWaitingLayout } from '../src/card/waitingLayout.ts';

const waiting = {
  filling: true,
  hasResult: false,
  answerStarted: false,
  layoutCount: 3,
  needsSources: true,
  sourcesSettled: true,
};

test('the plan skeleton shows once sources have settled and the answer has not started', () => {
  assert.equal(showWaitingLayout(waiting), true);
  assert.equal(showWaitingLayout({ ...waiting, sourcesSettled: false }), false);
  assert.equal(showWaitingLayout({ ...waiting, needsSources: false, sourcesSettled: false }), true);
});

test('a finished card does not fall back to the placeholder when the live stream is cleared', () => {
  assert.equal(showWaitingLayout({ ...waiting, filling: false, hasResult: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, hasResult: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, answerStarted: true }), false);
  assert.equal(showWaitingLayout({ ...waiting, filling: false }), false);
});
