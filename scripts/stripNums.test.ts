import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripNums } from '../server/claims.ts';

test('a number the sources do not back goes with its unit and currency sign', () => {
  assert.equal(stripNums('A 120-nit display and 48 MP dual camera', ['120', '48']), 'A display and dual camera');
  assert.equal(stripNums('Pick it for the £799 Amazon price.', ['799']), 'Pick it for the Amazon price.');
  assert.equal(stripNums('Battery lasts 21 days on a charge.', ['21']), 'Battery lasts on a charge.');
});

test('a spec line drops each item whose number went, and keeps the rest whole', () => {
  assert.equal(stripNums('6.3″ · 256 GB · 8 GB RAM', ['6.3', '256', '8']), '');
  assert.equal(stripNums('6.3″ · 256 GB · Gemini built in', ['256']), '6.3″ · Gemini built in');
});

test('a removed year takes its preposition and the comma before it', () => {
  assert.equal(stripNums('In 1906 she became the first woman to be a professor.', ['1906']), 'She became the first woman to be a professor.');
  assert.equal(stripNums('There are no scores for October 19, 2026.', ['19', '2026']), 'There are no scores for October.');
  assert.equal(stripNums('University of Paris, 1906', ['1906']), 'University of Paris');
});
