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

test('a long page keeps its opening, then the passages that answer the question', async () => {
  const { focusPage, keyLines } = await import('../server/pages.ts');
  const filler = Array.from({ length: 80 }, (_, i) => `Our kitchen blog has many recipes and tips for busy families number ${i}.`).join(' ');
  const text = `Should you wash raw chicken? A quick guide. ${filler} Cooking chicken to the proper internal temperature of 165 degrees Fahrenheit kills germs. ${filler}`;
  const focused = focusPage(text, 'Should I rinse raw chicken before I cook it?', 2000);
  assert.ok(focused.length <= 2100);
  assert.match(focused, /^Should you wash raw chicken/);
  assert.match(focused, /165 degrees Fahrenheit/);
  const lines = keyLines('Should I rinse raw chicken before I cook it?', [{ n: 3, text }]);
  assert.equal(lines[0]?.n, 3);
  assert.match(lines[0]?.line ?? '', /165 degrees/);
  // A short page is unchanged.
  assert.equal(focusPage('Short page about chicken.', 'raw chicken', 2000), 'Short page about chicken.');
});
