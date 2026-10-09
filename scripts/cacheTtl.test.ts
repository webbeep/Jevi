import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheTier, cacheTtlS } from '../shared/cacheTtl.ts';

test('live asks are reused for seconds', () => {
  for (const q of ['Lakers live score', 'bitcoin price', 'weather in Boston', 'Is the Warriors game live', 'AAPL stock price right now', 'breaking news Gaza']) {
    assert.equal(cacheTier(q), 'live', q);
  }
  assert.equal(cacheTtlS('Lakers live score'), 30);
});

test('today, news and stock moves are reused for minutes', () => {
  for (const q of ['AI news today', 'Warriors game tonight', 'why $rdw dropping', 'Nvidia earnings', 'Jaylen Brown injury', 'latest iPhone leaks']) {
    assert.equal(cacheTier(q), 'short', q);
  }
  assert.equal(cacheTtlS('AI news today'), 300);
});

test('schedules, standings and upcoming dates are reused for hours', () => {
  for (const q of ['NBA standings', 'Celtics schedule', 'when is the next Apple event', 'Lebron preseason debut', 'best laptop deals']) {
    assert.equal(cacheTier(q), 'medium', q);
  }
  assert.equal(cacheTtlS('NBA standings'), 3 * 3600);
});

test('evergreen asks are reused for a day', () => {
  for (const q of ['who is Ed Chu', 'how does photosynthesis work', 'Kindle vs Kobo', 'best apples for pie', 'Breaking Bad cast', 'where does Taylor Swift live']) {
    assert.equal(cacheTier(q), 'long', q);
  }
  assert.equal(cacheTtlS('who is Ed Chu'), 86400);
});

test('the freshness window can only make it shorter', () => {
  assert.equal(cacheTier('Kindle vs Kobo', 'day'), 'short');
  assert.equal(cacheTier('Kindle vs Kobo', 'week'), 'medium');
  assert.equal(cacheTier('Lakers live score', 'week'), 'live');
});
