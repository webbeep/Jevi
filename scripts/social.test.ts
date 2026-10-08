import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blueskySearch, maybeBluesky, parseBlueskySearch, wantsSocial } from '../server/social.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bsky-search-posts.json', import.meta.url), 'utf8'));

test('wants social only for briefing queries or day/week freshness', () => {
  assert.equal(wantsSocial('latest news today', 'any'), true);
  assert.equal(wantsSocial('apple pie recipe', 'any'), false);
  assert.equal(wantsSocial('apple pie recipe', 'day'), true);
  assert.equal(wantsSocial('bitcoin price', 'any'), false);
});

test('parseBlueskySearch keeps handle, post URL and timestamp from the captured fixture', () => {
  const posts = parseBlueskySearch(fixture);
  assert.equal(posts.length, 3);
  assert.equal(posts[0].handle, 'craigtimes.bsky.social');
  assert.match(posts[0].url, /^https:\/\/bsky\.app\/profile\/craigtimes\.bsky\.social\/post\/3mx/);
  assert.equal(posts[0].date, '2026-10-08T00:55:35.516Z');
  assert.match(posts[0].snippet, /^@craigtimes\.bsky\.social: Ex-CIA official/);
  assert.match(posts[1].title, /gold bars/);
});

test('blueskySearch uses one mocked fetch and the captured fixture', async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const posts = await maybeBluesky({ q: 'latest news today', freshness: 'any' }, { ZO_SOCIAL: '1' });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /api\.bsky\.app\/xrpc\/app\.bsky\.feed\.searchPosts/);
    assert.match(calls[0], /sort=latest/);
    assert.equal(posts.status?.ok, true);
    assert.equal(posts.status?.name, 'bluesky');
    assert.equal(posts.posts[0].handle, 'craigtimes.bsky.social');
  } finally {
    globalThis.fetch = original;
  }
});

test('flag off, timeless queries, and lite searches do not fetch', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  }) as typeof fetch;
  try {
    const off = await maybeBluesky({ q: 'latest news today', freshness: 'any' }, {});
    const timeless = await maybeBluesky({ q: 'apple pie recipe', freshness: 'any' }, { ZO_SOCIAL: '1' });
    const lite = await maybeBluesky({ q: 'latest news today', freshness: 'day', lite: true }, { ZO_SOCIAL: '1' });
    assert.equal(calls, 0);
    assert.deepEqual(off, { posts: [] });
    assert.equal(off.status, undefined);
    assert.equal(timeless.status, undefined);
    assert.equal(lite.status, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('a failed fetch is a no-op', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
  try {
    const out = await maybeBluesky({ q: 'latest news today', freshness: 'any' }, { ZO_SOCIAL: '1' });
    assert.deepEqual(out.posts, []);
    assert.equal(out.status?.ok, false);
    assert.equal(out.status?.count, 0);
    assert.match(out.status?.error ?? '', /HTTP 403/);
  } finally {
    globalThis.fetch = original;
  }
});

test('parse CPU stays well under a 10ms Workers budget', () => {
  const n = 200;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) parseBlueskySearch(fixture);
  const total = performance.now() - t0;
  const per = total / n;
  console.log(`bluesky parse bench: ${per.toFixed(4)} ms/call over ${n} (${total.toFixed(2)} ms total)`);
  assert.ok(per < 1, `parse took ${per} ms`);
  // blueskySearch is referenced so a rename fails the import, not only the parse path.
  assert.equal(typeof blueskySearch, 'function');
});
