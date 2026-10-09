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
import { permitted, thumbMatchesPage } from '../server/images.ts';
import { accepts, targetFor } from '../server/imageGate.ts';
import type { ImageResult } from '../shared/types.ts';
import { readFileSync } from 'node:fs';

/** Live Serper image pool for "Ray Lee Raycon CEO" (scripts/fixtures/en4/serper-live-raycon-images.json). */
const RAYCON_POOL = JSON.parse(
  readFileSync(new URL('./fixtures/en4/serper-live-raycon-images.json', import.meta.url), 'utf8'),
).images as ImageResult[];
/** The live pool pairs a Raycon video page with the hq720 frame of a different (unrelated) video. */
const WRONG_FRAME = RAYCON_POOL.find((i) => i.url.includes('youtube.com/watch'))!;
const FRAME_OF = (id: string) => `https://i.ytimg.com/vi/${id}/hq720.jpg`;

describe('EN4: a YouTube thumbnail must be a frame of the page\'s own video', () => {
  test('a frame of another video never matches its page', () => {
    assert.equal(thumbMatchesPage(WRONG_FRAME), false);
    assert.equal(thumbMatchesPage({ url: WRONG_FRAME.url, thumb: FRAME_OF('1Wic1K_ZkkU') }), true);
    for (const url of ['https://youtu.be/1Wic1K_ZkkU', 'https://www.youtube.com/shorts/1Wic1K_ZkkU', 'https://www.youtube.com/embed/1Wic1K_ZkkU']) {
      assert.equal(thumbMatchesPage({ url, thumb: FRAME_OF('1Wic1K_ZkkU') }), true, url);
      assert.equal(thumbMatchesPage({ url, thumb: FRAME_OF('MCottgyRxZY') }), false, url);
    }
    // Numbered thumbnail shards and the /vi_webp/ path name their video the same way.
    assert.equal(thumbMatchesPage({ url: 'https://youtu.be/1Wic1K_ZkkU', thumb: 'https://i9.ytimg.com/vi_webp/1Wic1K_ZkkU/webp.jpg' }), true);
    // Everything else — a non-YouTube picture, or a YouTube frame on a page that is not a video — passes.
    for (const img of RAYCON_POOL.filter((i) => i !== WRONG_FRAME)) assert.equal(thumbMatchesPage(img), true, img.thumb);
    assert.equal(thumbMatchesPage({ url: 'https://youtube.com/@raycon', thumb: FRAME_OF('1Wic1K_ZkkU') }), true);
    assert.equal(thumbMatchesPage({ url: 'https://lasentinel.net/ray-j.html', thumb: FRAME_OF('MCottgyRxZY') }), true);
    assert.equal(thumbMatchesPage({ url: 'https://www.youtube.com/watch?v=1Wic1K_ZkkU', thumb: 'https://i.ytimg.com/vi/1Wic1K_ZkkU/hq720.jpg' }), true);
  });

  test('permitted drops exactly that frame from the live pool', () => {
    const kept = permitted(RAYCON_POOL, {} as never);
    assert.equal(kept.length, RAYCON_POOL.length - 1);
    assert.ok(!kept.includes(WRONG_FRAME));
    assert.deepEqual(kept.map((i) => i.url), RAYCON_POOL.filter((i) => i !== WRONG_FRAME).map((i) => i.url));
  });

  test('no Ray J photo passes the single-entity photo gate after the filter', () => {
    const target = targetFor('Ray Lee', '', undefined, {
      hintFor: () => ({ name: 'Ray Lee', context: ['raycon'], strict: true, requireContext: true }),
    });
    assert.equal(target.kind, 'named');
    for (const img of permitted(RAYCON_POOL, {} as never)) {
      if (/ray\s*lee/i.test(`${img.title} ${img.source}`)) continue;
      assert.equal(accepts(target, img), false, `${img.source}: ${img.title}`);
    }
    for (const host of ['lasentinel.net', 'harlemworldmagazine.com']) {
      const rayJ = RAYCON_POOL.filter((i) => i.source === host);
      assert.ok(rayJ.length > 0, host);
      for (const img of rayJ) assert.equal(accepts(target, img), false, `${host}: ${img.title}`);
    }
  });
});

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
