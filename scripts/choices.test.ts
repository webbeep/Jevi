import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choiceQuery, readChoices } from '../shared/choices.ts';
import type { Disambiguation } from '../shared/card.ts';

test('a valid shape is parsed and trimmed', () => {
  const found = readChoices({
    choices: {
      prompt: '  Which Michael Jordan?  ',
      options: [
        { name: '  Michael Jordan  ', descriptor: ' Basketball player ', query: ' michael jordan bulls ' },
        { name: 'Michael Jordan', descriptor: 'Actor' },
        { name: 'Michael Jordan', query: 'mj footballer' },
      ],
    },
  });
  const expected: Disambiguation = {
    prompt: 'Which Michael Jordan?',
    options: [
      { name: 'Michael Jordan', descriptor: 'Basketball player', query: 'michael jordan bulls' },
      { name: 'Michael Jordan', descriptor: 'Actor' },
      { name: 'Michael Jordan', query: 'mj footballer' },
    ],
  };
  assert.deepEqual(found, expected);
});

test('the array form of the draft entity-choices event is parsed', () => {
  const found = readChoices({ choices: [{ name: 'iPad Air', descriptor: '11-inch', query: 'ipad air 11', id: 'a1' }, { name: 'iPad Pro', descriptor: '13-inch', id: 'a2' }] });
  assert.deepEqual(found, { options: [{ name: 'iPad Air', descriptor: '11-inch', query: 'ipad air 11' }, { name: 'iPad Pro', descriptor: '13-inch' }] });
  assert.equal(found!.prompt, undefined);
  assert.equal(found!.options[0].query, 'ipad air 11');
  assert.ok(!('id' in found!.options[0]));
});

test('options on the payload itself are accepted', () => {
  assert.deepEqual(readChoices({ prompt: 'Which one?', options: [{ name: 'A' }, { name: 'B' }] }), { prompt: 'Which one?', options: [{ name: 'A' }, { name: 'B' }] });
});

test('fewer than two usable options give nothing', () => {
  assert.equal(readChoices({ choices: { options: [{ name: 'Only one' }] } }), undefined);
  assert.equal(readChoices({ choices: { options: [] } }), undefined);
  assert.equal(readChoices({ choices: [] }), undefined);
  assert.equal(readChoices({ choices: { options: [{ name: '  ' }, { name: 'B' }] } }), undefined);
});

test('junk types are dropped, and over-long strings are cut', () => {
  const long = 'x'.repeat(300);
  const found = readChoices({
    choices: {
      prompt: 42,
      options: [
        null,
        'nope',
        { name: 'A', descriptor: 7, query: long },
        { descriptor: 'no name' },
        { name: 'B' },
      ],
    },
  });
  assert.deepEqual(found, { options: [{ name: 'A', query: `${long.slice(0, 200)}` }, { name: 'B' }] });
  assert.equal(readChoices(null), undefined);
  assert.equal(readChoices('choices', { choices: 'nope' }), undefined);
  assert.equal(readChoices({ choices: { options: 'nope' } }), undefined);
  const longName = readChoices({ choices: { options: [{ name: 'y'.repeat(200) }, { name: 'B' }] } });
  assert.equal(longName!.options[0].name.length, 80);
  const longPrompt = readChoices({ choices: { prompt: 'p'.repeat(200), options: [{ name: 'A' }, { name: 'B' }] } });
  assert.equal(longPrompt!.prompt!.length, 80);
});

test('at most six options are kept', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `Option ${i + 1}` }));
  assert.equal(readChoices({ choices: { options: many } })!.options.length, 6);
  assert.equal(readChoices({ choices: { options: many } })!.options[5].name, 'Option 6');
});

test('the first payload with usable choices wins', () => {
  assert.deepEqual(readChoices({}, { choices: { options: [{ name: 'A' }, { name: 'B' }] } }, { choices: { options: [{ name: 'C' }, { name: 'D' }] } }), { options: [{ name: 'A' }, { name: 'B' }] });
  assert.deepEqual(readChoices({ choices: { options: [{ name: 'Only' }] } }, { choices: { options: [{ name: 'C' }, { name: 'D' }] } }), { options: [{ name: 'C' }, { name: 'D' }] });
  assert.equal(readChoices({ choices: {} }, undefined, 7), undefined);
});

test('choiceQuery prefers the query, then name with descriptor, then the name', () => {
  assert.equal(choiceQuery({ name: 'iPad Air', descriptor: '11-inch', query: 'ipad air 11 price' }), 'ipad air 11 price');
  assert.equal(choiceQuery({ name: 'iPad Air', descriptor: '11-inch' }), 'iPad Air (11-inch)');
  assert.equal(choiceQuery({ name: 'iPad Air' }), 'iPad Air');
  assert.equal(choiceQuery({ name: 'iPad Air', query: '   ' }), 'iPad Air');
});
