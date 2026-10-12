import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusPage } from '../server/pages.ts';

const bio = 'Jayson Tatum Boston Celtics bio. '.repeat(400);
const line = 'Jayson Tatum scored 23 points (9-19 FG, 4-10 3Pt) and five rebounds in the preseason win over the 76ers.';
const page = `${bio}${' '.repeat(5000)}${line}`;

test('a preseason ask keeps the game line that sits past the bio', () => {
  const out = focusPage(page, 'Jayson Tatum Preseason Stats', 6000);
  assert.match(out, /23 points \(9-19 FG, 4-10 3Pt\)/);
  assert.match(out, /five rebounds/);
  assert.ok(out.length <= 6001);
  assert.ok(out.startsWith('Jayson Tatum Boston Celtics bio.'));
});

test('a career ask stays on the opening and does not jump to a later line', () => {
  const out = focusPage(page, 'Jayson Tatum career stats', 6000);
  assert.equal(out.includes('23 points'), false);
  assert.ok(out.startsWith('Jayson Tatum Boston Celtics bio.'));
});
