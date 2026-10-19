import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedComparison, fallbackQuery, followSearchPlan, parseDecision, parseSourceDecision, placeOnScreen } from '../server/turnJudge.ts';

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
  assert.equal(placeOnScreen('Willis Tower Opening'), 'Willis Tower');
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

test('a singular follow-up on a comparison card asks about the side its lead settles', () => {
  const plan = followSearchPlan({
    title: 'Empire State Building vs. One WTC',
    question: 'When did it open?',
    queries: ['Empire State Building One WTC When did it open?'],
    subject: 'Empire State Building',
    lead: 'No — One World Trade Center is still the tallest One World Trade Center is the tallest No',
  });
  assert.equal(plan.query, 'When did One WTC open');
  assert.equal(plan.subject, 'One WTC');
  assert.deepEqual(plan.fanout, []);
  // Without a lead that picks one side, "each" still searches both.
  const both = followSearchPlan({ title: 'Harbor Slate vs Northwatch 2', question: 'When did it launch?', queries: [], subject: '', lead: 'Two smartwatches, side by side' });
  assert.equal(both.query, 'Harbor Slate vs Northwatch 2');
});

test('without the turn judge, a pronoun becomes the subject on screen', async () => {
  const { fallbackQuery } = await import('../server/turnJudge.ts');
  assert.equal(fallbackQuery('When did it open?', 'One World Trade Center'), 'When did One World Trade Center open');
  assert.equal(fallbackQuery('How far from Earth is it?', 'James Webb Space Telescope'), 'How far from Earth is James Webb Space Telescope');
  assert.equal(fallbackQuery('How big is its main mirror?', 'James Webb Space Telescope'), "How big is James Webb Space Telescope's main mirror");
  assert.equal(fallbackQuery('Who nominated him?', 'John Roberts'), 'Who nominated John Roberts');
  assert.equal(fallbackQuery('What are the hours?', 'Met Museum'), 'Met Museum What are the hours');
  assert.equal(fallbackQuery('Is the Met Museum open Monday?', 'Met Museum'), 'Is the Met Museum open Monday');
});

test('"what about X?" asks the card\'s question about X, keeping the topic', () => {
  const plan = followSearchPlan({ title: 'AI News Today', question: 'what about Google?', queries: ['Google'], subject: 'Google' });
  assert.equal(plan.query, 'Google AI News Today');
  assert.equal(plan.subject, 'Google');
  const same = followSearchPlan({ title: 'Google AI News', question: 'what about Google?', queries: ['Google AI news'], subject: 'Google' });
  assert.equal(same.query, 'Google AI news');
});

test('a follow-up names the thing a card title is about, not the attribute it showed', async () => {
  const { titleSubject } = await import('../shared/titleSubject.ts');
  assert.equal(titleSubject('Empire State Building Height'), 'Empire State Building');
  assert.equal(titleSubject('Nintendo Switch 2 Price'), 'Nintendo Switch 2');
  assert.equal(titleSubject('Met Museum Hours'), 'Met Museum');
  assert.equal(titleSubject('Price'), 'Price');
  assert.equal(placeOnScreen('Empire State Building Height'), 'Empire State Building');
  const plan = followSearchPlan({ title: 'Empire State Building Height', question: 'When did it open?', queries: [], subject: '' });
  assert.equal(plan.query, 'When did Empire State Building open');
});

test('a question-shaped title gives its subject with the model number, and the follow-up search names it', () => {
  assert.equal(placeOnScreen('How Much Does a Nintendo Switch 2 Cost in the US Right Now'), 'Nintendo Switch 2');
  assert.equal(placeOnScreen('Nintendo Switch 2 Price'), 'Nintendo Switch 2');
  const plan = followSearchPlan({ title: 'Nintendo Switch 2 Price', question: 'What would I pay with sales tax in New York City?', queries: [], subject: '' });
  assert.equal(plan.query, 'Nintendo Switch 2 What would I pay with sales tax in New York City');
});

test('a follow-up that names its own subject is searched as asked, and a title is cut at its first attribute', () => {
  const flagg = followSearchPlan({ title: 'NBA Scores Tonight', question: 'What is Cooper Flagg?', queries: ['Cooper Flagg'], subject: 'Cooper Flagg' });
  assert.equal(flagg.query, 'Cooper Flagg');
  assert.equal(placeOnScreen('JWST Distance From Earth'), 'JWST');
  const mirror = followSearchPlan({ title: 'JWST Distance From Earth', question: "How big is its main mirror compared with Hubble's?", queries: [], subject: '' });
  assert.match(mirror.query, /^How big is JWST's main mirror/);
});

test('a possessive subject is not made possessive twice', () => {
  assert.equal(fallbackQuery("How big is its main mirror compared with Hubble's?", "Webb's"), "How big is Webb's main mirror compared with Hubble's");
});

test('a follow-up that only changes the qualifier keeps the fact asked', () => {
  const ohio = followSearchPlan({ title: 'NY State Met Admission', question: 'And for a visitor from Ohio?', queries: [], subject: '' });
  assert.equal(ohio.query, 'NY State Met Admission for a visitor from Ohio');
  const judged = followSearchPlan({ title: 'NY State Met Admission', question: 'And for a visitor from Ohio?', queries: ['Met Museum admission price for out-of-state visitors'], subject: 'The Met' });
  assert.equal(judged.query, 'Met Museum admission price for out-of-state visitors');
});

test('a pronoun after a rejected claim points at the name the card affirmed', () => {
  const plan = followSearchPlan({
    title: 'Empire State Building vs NYC Record',
    question: 'When did it open?',
    queries: [],
    subject: '',
    lead: 'No — One World Trade Center is still the tallest Empire State Building is not the tallest No',
  });
  assert.equal(plan.query, 'When did One World Trade Center open');
  assert.equal(plan.subject, 'One World Trade Center');
  // A lead that is not a rejection leaves the old reading alone.
  const kept = followSearchPlan({ title: 'Empire State Building vs. One WTC', question: 'When did it open?', queries: ['Empire State Building One WTC When did it open?'], subject: '', lead: 'No — One WTC is still the tallest' });
  assert.equal(kept.subject, 'One WTC');
});
