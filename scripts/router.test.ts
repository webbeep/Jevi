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

import { testForce, cacheBypass } from '../server/token.ts';
import { permitted } from '../server/images.ts';

describe('QA force flag and image hygiene', () => {
  const env = { ZO_TEST_TOKEN: 'tok' } as unknown as Parameters<typeof testForce>[1];
  const req = (h: Record<string, string>) => new Request('https://zo.page/api/stream', { headers: h });
  test('force flag needs a valid test token and always bypasses caches', () => {
    assert.equal(testForce(req({ 'x-zo-test-force': 'serper-off', 'x-zo-test-token': 'tok' }), env), 'serper-off');
    assert.equal(testForce(req({ 'x-zo-test-force': 'degraded', 'x-zo-test-token': 'tok' }), env), 'degraded');
    assert.equal(testForce(req({ 'x-zo-test-force': 'degraded', 'x-zo-test-token': 'nope' }), env), undefined);
    assert.equal(testForce(req({ 'x-zo-test-force': 'degraded' }), env), undefined);
    assert.equal(testForce(req({ 'x-zo-test-force': 'degraded', 'x-zo-test-token': '' }), {} as typeof env), undefined);
    assert.equal(testForce(req({ 'x-zo-test-force': 'other', 'x-zo-test-token': 'tok' }), env), undefined);
    assert.equal(cacheBypass(req({ 'x-zo-test-force': 'degraded', 'x-zo-test-token': 'tok' }), env), true);
    assert.equal(cacheBypass(req({ 'x-zo-test-force': 'degraded', 'x-zo-test-token': 'bad' }), env), false);
  });
  test('only https pictures pass', () => {
    const img = (thumb: string) => ({ url: 'https://a.com/x', thumb, title: 't', source: 'a.com', license: 'source' as const });
    assert.deepEqual(permitted([img('http://a.com/p.jpg'), img('https://a.com/p.jpg'), img('data:image/png;base64,xx')], {} as never).map((i) => i.thumb), ['https://a.com/p.jpg']);
  });
});
