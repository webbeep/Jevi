import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripNums } from '../server/claims.ts';

test('a figure the sources do not back takes its whole sentence, never leaving half of it', () => {
  assert.equal(stripNums('It has a 120-nit display and 48 MP dual camera. It ships in black.', ['120', '48']), 'It ships in black.');
  assert.equal(stripNums('Pick it for the £799 Amazon price.', ['799']), '');
  assert.equal(stripNums('Under $100', ['100']), '');
  assert.equal(stripNums('He debuted on Friday, Oct. 16 vs. the Celtics. He played 22 minutes.', ['16']), 'He played 22 minutes.');
});

test('a spec line drops each item whose number went, and keeps the rest whole', () => {
  assert.equal(stripNums('6.3″ · 256 GB · 8 GB RAM', ['6.3', '256', '8']), '');
  assert.equal(stripNums('6.3″ · 256 GB · Gemini built in', ['256']), '6.3″ · Gemini built in');
});

test('a year goes in place with the words that pointed at it, so the fact beside it stays', () => {
  assert.equal(stripNums('In 1906 she became the first woman to be a professor.', ['1906']), 'She became the first woman to be a professor.');
  assert.equal(stripNums('There are no games on the 2026 schedule today.', ['2026']), 'There are no games on the schedule today.');
  assert.equal(stripNums('University of Paris, 1906', ['1906']), 'University of Paris');
});

test('an aside in parentheses goes on its own', () => {
  assert.equal(stripNums('Sales tax is 4% ($6).', ['6']), 'Sales tax is 4%.');
});
