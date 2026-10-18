import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { dropDisputedBio, type BioSource } from '../server/bioFacts.ts';

const profile = (facts: { label: string; value: string }[]): CardNode => ({ type: 'profile', name: 'Ada Lovelace', facts });

function wiki(text: string): BioSource {
  return { title: 'Ada Lovelace', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace', domain: 'wikipedia.org', text: `Ada Lovelace. ${text}` };
}

test('a person card does not assert a birthplace the sources dispute', () => {
  const nodes: CardNode[] = [
    profile([{ label: 'Born', value: '10 December 1815, London' }, { label: 'Field', value: 'Mathematics' }]),
    { type: 'tile', label: 'Owns', value: '~12% of the press' },
    { type: 'tile', label: 'Latest honor', value: 'Royal Medal of Merit' },
    { type: 'text', text: 'Ada Lovelace was born in London. She owns about 12% of the press.', size: 'md' },
  ];
  const sources: BioSource[] = [
    wiki('Ada Lovelace was born in London.'),
    { title: 'Ada Lovelace biography', url: 'https://example.edu/bio/ada-lovelace', domain: 'example.edu', text: 'Ada Lovelace was born in Exeter.' },
  ];
  const next = JSON.stringify(dropDisputedBio(nodes, sources, { person: 'Ada Lovelace', question: 'Who is Ada Lovelace' }));
  assert.equal(next.includes('London'), false);
  assert.equal(next.includes('Exeter'), false);
  assert.match(next, /Mathematics/);
  assert.equal(next.includes('12%'), false);
  assert.equal(next.includes('Royal Medal'), false);
  assert.match(next, /10 December 1815/);
});

test('a fetched page that contradicts the snippet drops the birthplace', () => {
  const nodes: CardNode[] = [
    profile([]),
    { type: 'tile', label: 'Born', value: 'London' },
  ];
  const sources: BioSource[] = [{
    title: 'Ada Lovelace biography',
    url: 'https://example.edu/bio/ada-lovelace',
    domain: 'example.edu',
    stated: 'Ada Lovelace was born in London.',
    text: 'Ada Lovelace was born in Exeter.',
  }];
  const next = JSON.stringify(dropDisputedBio(nodes, sources, { question: 'Who is Ada Lovelace' }));
  assert.equal(next.includes('London'), false);
  assert.equal(next.includes('Exeter'), false);
});

test('a follow-up does not repeat a birthplace it did not ask for', () => {
  const nodes: CardNode[] = [
    profile([{ label: 'Born', value: 'London' }]),
    { type: 'tile', label: 'Degree', value: 'Mathematics' },
  ];
  const next = JSON.stringify(dropDisputedBio(nodes, [wiki('Ada Lovelace was born in London.')], {
    person: 'Ada Lovelace',
    question: 'What degrees does she have?',
    followup: true,
  }));
  assert.equal(next.includes('London'), false);
  assert.match(next, /Mathematics/);
});

test('an agreed birthplace stays when the question is about the person', () => {
  const nodes: CardNode[] = [profile([{ label: 'Born', value: 'London' }])];
  const next = JSON.stringify(dropDisputedBio(nodes, [wiki('Ada Lovelace was born in London.')], { question: 'Who is Ada Lovelace' }));
  assert.match(next, /London/);
});
