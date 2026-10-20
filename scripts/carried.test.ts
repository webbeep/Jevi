import assert from 'node:assert/strict';
import { test } from 'node:test';
import { citedRows, sameThread } from '../server/stream.ts';
import type { AnswerCard } from '../shared/card.ts';
import type { SearchResult } from '../shared/types.ts';

const row = (n: number): SearchResult => ({ title: `Page ${n}`, url: `https://example.com/${n}`, snippet: '', domain: 'example.com', engines: ['web'] });

test('a card carries the rows it cites, in the order it cites them, and nothing out of range', () => {
  const card: AnswerCard = { title: 'Nintendo Switch 2 Price', body: [
    { type: 'hero', value: '$499.99', label: 'US MSRP', caption: 'From Sep 1, 2026 [3]' },
    { type: 'text', text: 'Raised from $449.99 [3][1]. Resale is lower [9].' },
    { type: 'citations', refs: [3, 2] },
  ] };
  assert.deepEqual(citedRows(card, [1, 2, 3, 4].map(row)).map((r) => r.url), ['https://example.com/3', 'https://example.com/1', 'https://example.com/2']);
});

test('a follow-up on the same subject keeps the card\'s sources, a new topic does not', () => {
  assert.equal(sameThread('Nintendo Switch 2 price with sales tax in New York City', 'Nintendo Switch 2 Price'), true);
  assert.equal(sameThread('What is photosynthesis', 'How mRNA Vaccines Work'), false);
  assert.equal(sameThread('Google AI News Today', 'AI News Today'), true);
});

test('a three-letter name keeps the thread', () => {
  assert.equal(sameThread('NY State Met for a visitor from Ohio', 'Met Admission for New York Residents'), true);
  assert.equal(sameThread('What is photosynthesis', 'How mRNA Vaccines Work'), false);
});

test('a comparison of account rules skips the product searches, a product comparison keeps them', async () => {
  const { rulesCompare } = await import('../server/stream.ts');
  assert.equal(rulesCompare('Make a table comparing a Roth IRA and a traditional IRA for 2026: contribution limit, tax treatment, and income limits.'), true);
  assert.equal(rulesCompare('Compare the iPhone 17 and Pixel 10 side by side: starting price and base storage.'), false);
  assert.equal(rulesCompare('iphone 17 vs pixel 10'), false);
  assert.equal(rulesCompare('fitbit edge vs mi band 10 specs'), false);
});

test('a follow-up on a new topic the card never mentions searches, one that points back does not', async () => {
  const { newTopic } = await import('../server/stream.ts');
  const card = 'How mRNA Vaccines Work\nmRNA teaches cells to make a spike protein. Moderna, Pfizer vaccine sources.';
  assert.equal(newTopic('What is photosynthesis?', card), true);
  assert.equal(newTopic('explain it like I am 10', card), false);
  // The cost of the thing on screen with a tax or a fee added is about that thing, even when no word of it is repeated.
  assert.equal(newTopic('What would I pay with sales tax in New York City?', card), false);
  assert.equal(newTopic('How much is it after shipping?', card), false);
  assert.equal(newTopic('Can I use rye flour instead?', 'Sourdough starter: mix flour and water, feed daily.'), false);
  assert.equal(newTopic('which one has better battery life?', 'iPhone 17 vs Pixel 10'), false);
});

test('an elliptical follow-up leans on the card and is never a new topic', async () => {
  const { newTopic } = await import('../server/stream.ts');
  const card = 'NY State Met Admission · Pay what you wish · Standard adult $30';
  assert.equal(newTopic('And for a visitor from Ohio?', card), false);
  assert.equal(newTopic('What about Google?', 'AI News Today · OpenAI ships a model'), false);
  assert.equal(newTopic('In Boston?', 'Weather in Seattle · 65°F'), false);
  assert.equal(newTopic('What is photosynthesis?', 'How mRNA vaccines work · Spike protein'), true);
});

test('a "which" question picks from the card and is never a new topic', async () => {
  const { newTopic } = await import('../server/stream.ts');
  assert.equal(newTopic('Which is lightest for travel?', 'Best Budget ANC Headphones · Soundcore Space Q45 · JBL Tune 770NC'), false);
});
