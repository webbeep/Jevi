import assert from 'node:assert/strict';
import { test } from 'node:test';
import { movesOn } from '../server/ai.ts';
import { personSubject } from '../server/entity.ts';
import { readPeople } from '../server/peopleSplit.ts';
import { personSteer, threadPerson, topicOnly, withoutChosen } from '../server/personSteer.ts';
import { plainQuotes } from '../server/queryClean.ts';

test('"not this" and friends reject the person on screen', () => {
  for (const q of ['not this', 'Not this one', 'wrong person', 'no, someone else', 'not him', 'a different Ed Chu?']) {
    assert.deepEqual(personSteer(q), { kind: 'reject' }, q);
  }
});

test('naming who they meant narrows to that person', () => {
  assert.deepEqual(personSteer('from Blueflame ai'), { kind: 'narrow', detail: 'Blueflame ai' });
  assert.deepEqual(personSteer('not this, the one from BlueFlame AI'), { kind: 'narrow', detail: 'BlueFlame AI' });
  assert.deepEqual(personSteer('the one who works at Google'), { kind: 'narrow', detail: 'Google' });
  assert.deepEqual(personSteer('the Revco one'), { kind: 'narrow', detail: 'Revco' });
  assert.deepEqual(personSteer('not this , from blueflame ai'), { kind: 'narrow', detail: 'blueflame ai' });
});

test('ordinary follow-ups are left to the rewrite', () => {
  for (const q of ['what did he do at Montefiore?', 'tell me about his research', 'how old was he', 'show his publications from 2020']) {
    assert.equal(personSteer(q), undefined, q);
  }
});

test('the thread person comes from the first ask, and the chosen-person lock can be dropped', () => {
  assert.equal(threadPerson('Who Is Ed Chu', '- Q: Ed Chu cancer center director Montefiore Einstein → Edward Chu'), 'Ed Chu');
  assert.equal(threadPerson('best pizza nyc', 'Chosen person: Ray Lee — Founder @ BlueFlame AI'), 'Ray Lee');
  assert.equal(withoutChosen('Chosen person: Ed Chu — Oncologist\n- Q: who is ed chu → Edward Chu'), '- Q: who is ed chu → Edward Chu');
});

test('"not this" after a first-name ask offers the other people with that name', () => {
  assert.equal(threadPerson("Who's Ricky", 'Chosen person: Ricky Cheuk — Hong Kong rugby'), 'Ricky');
  assert.equal(threadPerson(plainQuotes('Who’s Ricky'), 'Chosen person: Ricky Cheuk — Hong Kong rugby'), 'Ricky');
  assert.equal(personSubject(plainQuotes('Who’s Ricky')), 'Ricky');
  assert.equal(personSubject('whos Jessica Hamrick'), 'Jessica Hamrick');
});

test('people choices carry the full name the results use, never a stray one', () => {
  const rows = { people: [
    { name: 'Ricky Gervais', who: 'English comedian, The Office co-creator', rows: [1], query: 'Ricky Gervais comedian' },
    { name: 'Who is Ricky', who: 'Dancer, Ariana Grande tour', rows: [2], query: 'Ricky Alvarez dancer' },
  ] };
  const out = readPeople(rows, 'Ricky', 3);
  assert.deepEqual(out?.map((c) => c.name), ['Ricky Gervais', 'Ricky']);
});

test('a picked person searches with the topic only, never the earlier cards', () => {
  const ctx = 'Topic: who is ed chu\nEarlier turns, oldest first:\n- Q: x → y\nLatest card (Q: Ed Chu, bf ai): Edward Chu, computer scientist, sensor grids';
  assert.equal(topicOnly(ctx), 'Topic: who is ed chu');
  assert.equal(topicOnly(undefined), undefined);
});

test('the chosen person is not carried into a follow-up about someone else', () => {
  assert.equal(movesOn('who runs Datasite?', 'Ed Chu'), true);
  assert.equal(movesOn('what about Joe Lacob', 'Ed Chu'), true);
  assert.equal(movesOn('what does he do at Blueflame?', 'Ed Chu'), false);
  assert.equal(movesOn('tell me more', 'Ed Chu'), false);
  assert.equal(movesOn('Ed Chu education', 'Ed Chu'), false);
});
