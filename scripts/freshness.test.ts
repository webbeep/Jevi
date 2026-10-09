import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessFreshness, preferFresh, staleComplaint, stricter } from '../server/freshness.ts';

test('guessFreshness reads the time words in the ask', () => {
  assert.equal(guessFreshness('AI News Today'), 'day');
  assert.equal(guessFreshness("today's AI updates"), 'day');
  assert.equal(guessFreshness('latest AI updates'), 'week');
  assert.equal(guessFreshness('how tall is lebron'), 'any');
});

test('stricter keeps the narrower window', () => {
  assert.equal(stricter('week', 'day'), 'day');
  assert.equal(stricter('any', 'week'), 'week');
  assert.equal(stricter('any', 'any'), 'any');
});

test('staleComplaint catches "not today" replies and nothing else', () => {
  for (const text of ["It's not today's update", 'this is not today', 'that is old news', 'these are outdated', 'not the latest', 'this was from last week']) {
    assert.equal(staleComplaint(text), true, text);
  }
  for (const text of ['how old is lebron', 'what about OpenAI?', 'show me more from today', "why isn't AAPL up today", 'why is it not dropping today', 'why is the stock not dropping today after the earnings call and the guidance raise everyone expected']) {
    assert.equal(staleComplaint(text), false, text);
  }
});

const NOW = Date.parse('2026-10-09T15:00:00Z');
const row = (id: string, date?: string) => ({ id, date });

test('preferFresh drops past-window dated rows once three current ones remain', () => {
  const rows = [row('old1', '2026-10-01'), row('new1', '2026-10-09T10:00:00Z'), row('evergreen'), row('new2', '2026-10-08T20:00:00Z'), row('new3', '2026-10-09'), row('old2', '2026-09-20')];
  assert.deepEqual(
    preferFresh(rows, 'day', NOW).map((r) => r.id),
    ['new1', 'new2', 'new3', 'evergreen'],
  );
});

test('preferFresh leaves a thin list alone and ignores timeless asks', () => {
  const rows = [row('old1', '2026-10-01'), row('new1', '2026-10-09'), row('old2', '2026-09-20')];
  assert.deepEqual(preferFresh(rows, 'day', NOW).map((r) => r.id), ['old1', 'new1', 'old2']);
  const fresh = [row('a', '2026-10-09'), row('b', '2026-10-09'), row('c', '2026-10-09'), row('old', '2020-01-01')];
  assert.deepEqual(preferFresh(fresh, 'any', NOW).map((r) => r.id), ['a', 'b', 'c', 'old']);
});
