import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extraQueries, nearLiteral } from '../server/understand.ts';

describe('rewrite queries', () => {
  test('the literal ask plus one filler word is not a rewrite', () => {
    assert.equal(nearLiteral('iPhone 17 vs Pixel 10 comparison', 'iphone 17 vs pixel 10'), true);
    assert.equal(nearLiteral('Btc Usd', 'btc usd'), true);
    assert.equal(nearLiteral('BTC USD price today', 'Btc Usd'), false);
    assert.equal(nearLiteral('top AI news October 9 2026', 'AI news today'), false);
  });

  test('each side of a comparison keeps its search', () => {
    const u = { intent: 'Compare the phones.', queries: ['iPhone 17 vs Pixel 10 comparison', 'iPhone 17 review specs 2026', 'Google Pixel 10 review specs 2026'], freshness: 'any' as const };
    assert.deepEqual(extraQueries('iphone 17 vs pixel 10', u), ['iPhone 17 review specs 2026', 'Google Pixel 10 review specs 2026']);
  });

  test('a paper ask does not spend search slots on catalog rewrites', () => {
    const u = { intent: 'Find papers.', queries: ['climate change extreme weather peer reviewed', 'climate attribution DOI 2024'], freshness: 'any' as const };
    assert.deepEqual(extraQueries('Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs', u), []);
    assert.deepEqual(extraQueries('attention is all you need arxiv preprint', u), []);
  });
});
