import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personSteer, threadPerson, withoutChosen } from '../server/personSteer.ts';

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
