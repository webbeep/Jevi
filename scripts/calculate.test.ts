import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculationAnswer, figureValue, isCalculationAsk, readFigures, subjectTitle } from '../server/calculate.ts';
import { extractStats } from '../server/extract.ts';
import type { AnswerCard } from '../shared/card.ts';

const headline = '10/9 The Lead: Three Darkhorse First-Time All-Stars for the 2026-27 Season';

test('a calculation follow-up is arithmetic on the card, and a how-to is not', () => {
  assert.equal(isCalculationAsk('Can you just do the math'), true);
  assert.equal(isCalculationAsk('do the math'), true);
  assert.equal(isCalculationAsk('Add the points, rebounds, and assists'), true);
  assert.equal(isCalculationAsk("What's the total of those"), true);
  assert.equal(isCalculationAsk('Add them up'), true);
  assert.equal(isCalculationAsk('How many wolves live in Minnesota'), false);
  assert.equal(isCalculationAsk('Draft the unblock email'), false);
  assert.equal(isCalculationAsk('How to calculate a mortgage payment'), false);
  assert.equal(isCalculationAsk('What is the formula for the area of a circle'), false);
});

test('a clock stays whole, and weight is not labeled as a points line', () => {
  const clock = readFigures('1 shots over 15:07 minutes of action.');
  assert.equal(clock.length, 1);
  assert.equal(clock[0]!.display, '15:07');
  assert.equal(figureValue(clock[0]!), '15:07');
  assert.equal(clock[0]!.label, 'Minutes');
  assert.notEqual(figureValue(clock[0]!), '07 minutes');

  const mixed = readFigures('PPG 19.7 RPG 2.8 APG 5.1 and weighs 88kg.');
  assert.equal(mixed.find((f) => f.label === 'PPG')?.amount, 19.7);
  const weight = mixed.find((f) => f.amount === 88);
  assert.equal(weight?.label, 'Weight');
  assert.equal(weight?.unit, 'kg');
  assert.notEqual(weight?.label, 'PPG');

  const minutes = readFigures('He played 339 minutes in the exhibition.');
  assert.equal(minutes.length, 1);
  assert.equal(minutes[0]!.amount, 339);
  assert.equal(minutes[0]!.label, 'Minutes');
  assert.equal(figureValue(minutes[0]!), '339 minutes');
});

test('extractive stats keep each measure with its own label', () => {
  const stats = extractStats([{
    id: 's0',
    text: 'PPG 19.7 RPG 2.8 APG 5.1 and weighs 88kg. 1 shots over 15:07 minutes of action.',
    url: 'https://stats.example/box',
    domain: 'stats.example',
  }], 6);
  assert.ok(stats.every((s) => s.label.length < 40));
  assert.ok(stats.some((s) => s.label === 'PPG' && s.value === '19.7'));
  assert.ok(stats.some((s) => s.label === 'Weight' && s.value.includes('88')));
  assert.equal(stats.some((s) => s.value === '07' || s.value === '07 minutes'), false);
  assert.ok(stats.some((s) => s.value === '15:07'));
  assert.equal(stats.some((s) => s.label.includes('PPG') && s.value.includes('88')), false);
});

test('adding named stats does not pull an unrelated headline or a different measure', () => {
  const card: AnswerCard = {
    title: 'Player Stats',
    body: [
      { type: 'stat', label: 'PPG', value: '19.7' },
      { type: 'stat', label: 'RPG', value: '2.8' },
      { type: 'stat', label: 'APG', value: '5.1' },
      { type: 'stat', label: 'Weight', value: '88', unit: 'kg' },
    ],
  };
  const answer = calculationAnswer({
    question: 'Add the points, rebounds, and assists',
    original: 'player stats',
    priorTitle: 'Player Stats',
    card,
    search: {
      results: [{ title: headline, snippet: 'He weighs 88kg and played 339 minutes. 1 shots over 15:07 minutes of action.' }],
    },
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.title, 'Player Stats');
  assert.equal(answer.subtitle, 'Total');
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('88'), false);
  assert.equal(body.includes('15:07'), false);
  assert.match(body, /27\.6/);
  assert.match(body, /19\.7/);
  assert.match(body, /2\.8/);
  assert.match(body, /5\.1/);
});

test('a non-sports "do the math" adds the same-unit figures and keeps the subject capitalization', () => {
  assert.equal(subjectTitle('ada lovelace notes', 'Ada Lovelace'), 'Ada Lovelace Notes');
  assert.equal(subjectTitle('monthly rent and utilities', 'Monthly Rent and Utilities'), 'Monthly Rent and Utilities');
  const card: AnswerCard = {
    title: 'Monthly Rent and Utilities',
    body: [
      { type: 'stat', label: 'Rent', value: '$1,800' },
      { type: 'stat', label: 'Utilities', value: '$240' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'monthly rent and utilities',
    priorTitle: card.title,
    card,
    search: { results: [{ title: headline, snippet: 'Unrelated 88kg note.' }] },
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.title, 'Monthly Rent and Utilities');
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('88'), false);
  assert.match(body, /\$1,800/);
  assert.match(body, /\$240/);
  assert.match(body, /\$2,040/);
});

test('two different measures are not added into one number', () => {
  const card: AnswerCard = {
    title: 'Box Score',
    body: [
      { type: 'stat', label: 'PPG', value: '19.7' },
      { type: 'stat', label: 'Weight', value: '88', unit: 'kg' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'box score',
    priorTitle: 'Box Score',
    card,
    search: { results: [{ title: headline, snippet: 'A season preview.' }] },
  });
  const body = JSON.stringify(answer);
  assert.equal(body.includes('107.7'), false);
  assert.equal(body.includes('Darkhorse'), false);
  assert.match(body, /different measures/);
  assert.match(body, /19\.7/);
  assert.match(body, /88 kg/);
});

test('a second line of the same measure is not added again', () => {
  const card: AnswerCard = {
    title: 'Player Stats',
    body: [
      { type: 'stat', label: 'PTS', value: '21.8' },
      { type: 'stat', label: 'REB', value: '10' },
      { type: 'stat', label: 'AST', value: '5.3' },
      { type: 'stat', label: 'Career PTS', value: '23.5' },
      { type: 'stat', label: 'Career AST', value: '3.9' },
    ],
  };
  const answer = calculationAnswer({
    question: 'Add the points, rebounds, and assists',
    original: 'player stats',
    priorTitle: 'Player Stats',
    card,
  });
  const body = JSON.stringify(answer);
  assert.match(body, /37\.1/);
  assert.equal(body.includes('23.5'), false);
  assert.equal(body.includes('3.9'), false);
});

test('a nutrition table adds the calorie column, not every gram on the row', () => {
  const card: AnswerCard = {
    title: 'Banana vs Apple Calories',
    body: [
      { type: 'tile', label: 'Medium banana', value: '105' },
      { type: 'tile', label: 'Medium apple', value: '95' },
      {
        type: 'table',
        columns: ['', 'Medium banana', 'Medium apple'],
        rows: [
          ['Calories', '105', '95'],
          ['Carbs', '27 g', '25 g'],
          ['Sugar', '14 g', '19 g'],
        ],
      },
      { type: 'text', text: `${headline} A medium banana has about 5 calories and a medium apple about 95.` },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'calories in a medium banana and a medium apple',
    priorTitle: card.title,
    card,
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.subtitle, 'Total');
  assert.match(body, /105/);
  assert.match(body, /95/);
  assert.match(body, /= 200/);
  assert.equal(body.includes('143'), false);
  assert.equal(body.includes('27'), false);
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('about 5'), false);
});

test('a total and a count become a rate when the ask is just to calculate', () => {
  const card: AnswerCard = {
    title: 'Season Totals',
    body: [
      { type: 'stat', label: 'Points', value: '620' },
      { type: 'stat', label: 'Games', value: '36' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'season totals',
    priorTitle: 'Season Totals',
    card,
  });
  assert.equal(answer.subtitle, 'Rate');
  assert.match(JSON.stringify(answer), /17\.22/);
  assert.match(JSON.stringify(answer), /620/);
  assert.match(JSON.stringify(answer), /36/);
});
