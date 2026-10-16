import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOFTMAX_SCORES, claimsFigure, showsFigure, softmax } from '../shared/figure.ts';

test('softmax weights sum to one and peak on the largest score', () => {
  const weights = softmax(SOFTMAX_SCORES);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const scorePeak = SOFTMAX_SCORES.indexOf(Math.max(...SOFTMAX_SCORES));
  const weightPeak = weights.indexOf(Math.max(...weights));
  assert.equal(weightPeak, scorePeak);
  assert.ok(weights.every((weight) => weight > 0 && weight < 1));
});

test('a token-row caption is a figure claim, and a leadspace preview is not the figure', () => {
  assert.equal(claimsFigure('Each row is a token; brighter cells are the tokens it listens to most'), true);
  assert.equal(claimsFigure('How Softmax(QKᵀ) turns scores into focus'), true);
  assert.equal(claimsFigure('Nike Pegasus 41'), false);
  assert.equal(showsFigure({
    title: 'Attention mechanism',
    url: 'https://www.ibm.com/blog/attention',
    thumb: 'https://assets.ibm.com/is/image/ibm/attention-leadspace.jpg',
  }), false);
  assert.equal(showsFigure({
    title: 'Attention heatmap',
    url: 'https://en.wikipedia.org/wiki/Attention',
    thumb: 'https://upload.wikimedia.org/wikipedia/commons/attention-heatmap.png',
  }), true);
});
