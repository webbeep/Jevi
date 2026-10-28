import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askedFigureLines } from '../server/hops.ts';

const PASSPORT = 'Step by step, how do I renew my US passport by mail?';
const ROTH = 'Make a table comparing a Roth IRA and a traditional IRA for 2026: contribution limit, tax treatment, and income limits.';

test('a table that lost its first label is read with each label on the amount after it', () => {
  const found = askedFigureLines(PASSPORT, [
    { title: 'Renew Your Passport by Mail - Travel - State Department', snippet: 'not charge you a $35 facility fee. Your passport application fee depends on what document you are renewing. $130 Passport Card ・ $30 Passport Book and Card ・ $160 How to pay ...' },
  ]);
  assert.deepEqual(found?.lines.map((line) => line.line), ['Your passport application fee depends on what document you are renewing. $130 · Passport Card $30 · Passport Book and Card $160']);
});

test('a snippet starting mid-sentence is not read as the fee', () => {
  const found = askedFigureLines(PASSPORT, [{ title: 'Renew Your Passport by Mail', snippet: 'a $35 facility fee. Renew by mail with Form DS-82.' }]);
  assert.equal(found, undefined);
});

test('a labeled price list names its fees', () => {
  const found = askedFigureLines(PASSPORT, [{ title: 'Renew Your Passport Online', snippet: 'Passport book: $130 Passport card: $30 Passport book and card: $160 1 to 3-day delivery (optional): $26.87 A digital passport photo.' }]);
  assert.deepEqual(found?.lines[0]?.amounts, ['$130', '$30', '$160', '$26.87']);
});

test('income limits stated as MAGI, or under an income heading, are found', () => {
  const found = askedFigureLines(ROTH, [
    { title: 'Roth IRA vs. Traditional IRA', snippet: 'What are the income limits for IRA contributions? In 2026, single filers must make less than $153,000 to contribute fully to a Roth IRA and married couples ...' },
    { title: 'Roth IRA income and contribution limits', snippet: 'In 2026, married couples filing jointly can contribute to a Roth IRA if their MAGI is less than $242,000. Each spouse can have their own Roth IRA.' },
    { title: 'IRA contribution limits', snippet: 'In 2026, the Roth IRA contribution limit is $7,500, or $8,600 for those 50 and older.' },
  ]);
  assert.deepEqual(found?.lines.map((line) => line.line), [
    'In 2026, single filers must make less than $153,000 to contribute fully to a Roth IRA',
    'In 2026, married couples filing jointly can contribute to a Roth IRA if their MAGI is less than $242,000.',
  ]);
});

test('a fee table the snippet broke into sentences is read as one span', () => {
  const found = askedFigureLines(PASSPORT, [
    { title: 'Renew Your Passport by Mail - Travel - State Department', snippet: 'You can expect to receive these documents up to 4 weeks after your passport book ... … Pay your fees ; Passport Book · DS-82(opens in a new tab). $130 ; Passport Card · DS-82(opens in a new tab). $30 ; Passport Book and Card. DS-82( ...' },
  ]);
  assert.equal(found?.lines[0]?.line, 'Pay your fees · Passport Book · DS-82. $130 · Passport Card · DS-82. $30');
});
