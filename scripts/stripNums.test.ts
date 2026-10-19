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
