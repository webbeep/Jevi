import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { newLedger } from '../server/budget.ts';
import { estimateCost, routeExtras, routeOf } from '../server/router.ts';

describe('intent router', () => {
  test('quick: news, sports, shopping, lookups', () => {
    for (const q of ['2026 NBA preseason Nique Clifford', 'news today', 'Kings vs Lakers score', 'best running shoes under $100', 'Sacramento Kings preseason news', 'iphone 17 price']) {
      assert.equal(routeOf(q), 'quick', q);
    }
  });
  test('deep: research, compare, multi-part', () => {
    for (const q of ['compare Postgres and MySQL for analytics', 'Postgres vs MySQL', 'why did the Roman Empire fall', 'how does mRNA vaccine technology work', 'What is RAG? How is it different from fine-tuning?', 'pros and cons of heat pumps in cold climates']) {
      assert.equal(routeOf(q), 'deep', q);
    }
  });
  test('quick spends one rewrite, deep two', () => {
    assert.deepEqual(routeExtras('quick', ['a', 'b']), ['a']);
    assert.deepEqual(routeExtras('deep', ['a', 'b', 'c']), ['a', 'b']);
  });
  test('cost estimate counts calls and priced engines', () => {
    const l = newLedger();
    l.search.serper = 3;
    l.search.wikipedia = 1;
    l.pages.jina = 2;
    assert.deepEqual(estimateCost(l), { calls: 4, costUsd: 0.0034 });
  });
});
