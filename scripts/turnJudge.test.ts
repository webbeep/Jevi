import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedComparison, followSearchPlan, parseDecision, parseSourceDecision, placeOnScreen } from '../server/turnJudge.ts';

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
    queries: ['Compare Harbor Slate', 'Northwatch 2 specs'],
    subject: 'Harbor Slate',
  });
  assert.equal(plan.query, 'Harbor Slate vs Northwatch 2');
  assert.deepEqual(plan.fanout, ['Harbor Slate specs', 'Northwatch 2 specs']);
  const again = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2',
    question: 'Compare Harbor Slate vs Northwatch 2',
    queries: ['Compare Harbor Slate', 'Fitbit Air'],
    subject: 'Harbor Slate',
  });
  assert.equal(again.query, 'Harbor Slate vs Northwatch 2');
  assert.deepEqual(again.fanout, ['Harbor Slate', 'Northwatch 2']);
  for (const query of [again.query, ...again.fanout]) assert.doesNotMatch(query, /\bCompare\b/);
});

test('a fact follow-up keeps the product names and searches each one', () => {
  const plan = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2',
    question: 'What is the battery life of each?',
    queries: ['Harbor Slate vs Northwatch 2 What is the battery life of each?'],
    subject: 'Harbor Slate vs Northwatch 2',
  });
  assert.equal(plan.query, 'Harbor Slate vs Northwatch 2');
  assert.deepEqual(plan.fanout, ['Harbor Slate battery life', 'Northwatch 2 battery life']);
  assert.equal(plan.added, undefined);
  assert.doesNotMatch(plan.query, /battery/);
});

test('adding an object searches that object and does not glue the question onto a name', () => {
  const plan = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2 What Is the Battery Life of Each',
    question: 'Add the Glowband 4',
    queries: ['Add the Glowband 4'],
    subject: 'Harbor Slate',
  });
  assert.equal(plan.query, 'Harbor Slate vs Northwatch 2 vs Glowband 4');
  assert.equal(plan.added, 'Glowband 4');
  assert.ok(plan.fanout.includes('Glowband 4'));
  for (const query of [plan.query, ...plan.fanout]) assert.doesNotMatch(query, /battery|What|Add/i);
});

test('adding an object keeps every side even when the card title is missing', () => {
  const plan = addedComparison('Add the Glowband 4', ['', 'Harbor Slate versus Northwatch 2']);
  assert.equal(plan?.query, 'Harbor Slate vs Northwatch 2 vs Glowband 4');
  assert.equal(plan?.added, 'Glowband 4');
  assert.ok(plan?.fanout.includes('Glowband 4'));
  assert.equal(addedComparison('What is the battery life of each camera?', ['Harbor Slate vs Northwatch 2']), undefined);
});

test('switching to a different object searches only that object', () => {
  const plan = followSearchPlan({
    title: 'Harbor Slate vs Northwatch 2',
    question: 'Switch to the Glowband 4',
    queries: [],
    subject: 'Harbor Slate',
  });
  assert.equal(plan.query, 'Glowband 4');
  assert.equal(plan.added, 'Glowband 4');
  assert.deepEqual(plan.fanout, ['Glowband 4']);
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
