import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followSearchPlan, parseDecision, parseSourceDecision, placeOnScreen } from '../server/turnJudge.ts';

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

test('a comparison follow-up searches every product named on the card', () => {
  const plan = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2',
    question: 'Compare specs',
    queries: ['Harbor Slate specs', 'Northwatch 2 specs'],
    subject: 'Harbor Slate',
  });
  assert.match(plan.query, /Harbor Slate vs Northwatch 2/);
  assert.match(plan.query, /Compare specs/);
  assert.deepEqual(plan.fanout, ['Harbor Slate specs', 'Northwatch 2 specs']);
  const one = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2',
    question: 'Compare specs',
    queries: ['Harbor Slate specs'],
    subject: 'Harbor Slate',
  });
  assert.match(one.query, /Northwatch 2/);
});

test('the place on the card stays in front of a qualifier', () => {
  assert.equal(placeOnScreen('Art Institute of Chicago Illinois Resident Admission Price'), 'Art Institute of Chicago');
  assert.equal(placeOnScreen('Willis Tower Opening'), 'Willis Tower Opening');
  assert.equal(placeOnScreen("No — It's the Willis Tower"), 'Willis Tower');
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
