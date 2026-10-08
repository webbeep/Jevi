import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initials } from '../shared/initials.ts';

test('first and last initials', () => {
  assert.equal(initials('David Kim'), 'DK');
  assert.equal(initials('Madonna'), 'M');
  assert.equal(initials('John Ronald Reuel Tolkien'), 'JT');
});

test('a two-word name never takes two letters from the first word', () => {
  // QA/Lead: 'David Kim' rendered 'DA' and 'Ray Lee' 'RA' (name.slice(0, 2)).
  for (const [name, want] of [['David Kim', 'DK'], ['Ray Lee', 'RL'], ['Ray Allen', 'RA'], ['Alexander Lee', 'AL'], ['Ra Lee', 'RL']] as const) {
    const got = initials(name);
    assert.equal(got, want, name);
    assert.equal(got[1], name.trim().split(/\s+/)[1][0].toUpperCase(), name);
  }
});

test('whitespace runs are collapsed', () => {
  assert.equal(initials('  david   kim  '), 'DK');
  assert.equal(initials('David\tKim\n'), 'DK');
});

test('honorifics are dropped when another word remains', () => {
  assert.equal(initials('Dr. David Kim'), 'DK');
  assert.equal(initials('dr david kim'), 'DK');
  assert.equal(initials('Prof. Ada Lovelace'), 'AL');
  assert.equal(initials('Dr.'), 'D');
});

test('generational suffixes are dropped when another word remains', () => {
  assert.equal(initials('Martin Luther King Jr.'), 'MK');
  assert.equal(initials('Martin Luther King, Jr.'), 'MK');
});

test('the initial is the first letter or digit of a word', () => {
  assert.equal(initials('Jean-Luc Picard'), 'JP');
  assert.equal(initials('"David" Kim'), 'DK');
});

test('initials are Unicode aware', () => {
  assert.equal(initials('Émile Zola'), 'ÉZ');
  assert.equal(initials('王菲'), '王');
});

test('a name with no words gives no initials', () => {
  assert.equal(initials(''), '');
  assert.equal(initials('   '), '');
});

test('a trailing honorific still yields that word\'s initial', () => {
  assert.equal(initials('Mr. Smith'), 'S');
});
