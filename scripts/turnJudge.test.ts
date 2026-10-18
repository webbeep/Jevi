import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDecision, parseSourceDecision } from '../server/turnJudge.ts';

test('a follow-up decision is a search, an answer, or a calculation', () => {
  assert.deepEqual(parseDecision({
    action: 'search',
    queries: ['North Pier admission for a visitor from Ohio'],
    subject: 'North Pier',
  }), {
    action: 'search',
    queries: ['North Pier admission for a visitor from Ohio'],
    subject: 'North Pier',
  });
  assert.equal(parseDecision({ action: 'answer', queries: ['ignored'], subject: 'North Pier' })?.action, 'answer');
  assert.deepEqual(parseDecision({ action: 'answer', queries: ['ignored'], subject: 'North Pier' })?.queries, []);
  assert.equal(parseDecision({ action: 'calculate', queries: [], subject: 'North Pier' })?.action, 'calculate');
  assert.equal(parseDecision({ action: 'search', queries: [], subject: 'North Pier' }), undefined);
  assert.equal(parseDecision({ action: 'rewrite' }), undefined);
});

test('a source decision names one more search only when the snippets are not enough', () => {
  assert.deepEqual(parseSourceDecision({ enough: true, query: 'ignored' }), { enough: true, query: '' });
  assert.deepEqual(parseSourceDecision({ enough: false, query: 'North Pier official admission' }), {
    enough: false,
    query: 'North Pier official admission',
  });
  assert.equal(parseSourceDecision({ enough: false, query: '' }), undefined);
  assert.equal(parseSourceDecision({ enough: 'yes' }), undefined);
});
