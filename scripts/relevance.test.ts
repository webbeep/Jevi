import assert from 'node:assert/strict';
import { test } from 'node:test';
import { knowledgeMatches } from '../shared/relevance.ts';

const accept: [string, string][] = [
  ['Taylor Swift age', 'Taylor Swift'],
  ['eiffel tower height', 'Eiffel Tower'],
  ['who is Robert Pattinson', 'Robert Pattinson'],
  ['python list comprehension', 'List comprehension'],
  ['apple pie recipe', 'Apple pie'],
  ['good time film', 'Good Time (film)'],
  ['Good Time 2017 film', 'Good Time (film)'],
];

const reject: [string, string][] = [
  ['Is now a good time to buy a TV?', 'Good Time (film)'],
  ['3 days in Lisbon on a budget', 'RMS Virginian'],
  ['how to spend 3 days in lisbon complete 2026 itinerary', 'RMS Virginian'],
  ['best running shoes for beginners', 'Running'],
];

test('accepts encyclopedia entries about the query', () => {
  for (const [query, title] of accept) {
    assert.equal(knowledgeMatches(query, title), true, query);
  }
});

test('rejects encyclopedia entries about a different topic', () => {
  for (const [query, title] of reject) {
    assert.equal(knowledgeMatches(query, title), false, query);
  }
});
