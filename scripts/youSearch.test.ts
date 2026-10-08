import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mapYouHits, parseYouMcpSse, youKeyPresent } from '../server/youSearch.ts';
import type { Env } from '../server/util.ts';

const payload = JSON.parse(readFileSync(new URL('./fixtures/you-search-sony.json', import.meta.url), 'utf8'));
const sse = readFileSync(new URL('./fixtures/you-search-sony.sse', import.meta.url), 'utf8');

test('mapYouHits maps You.com web rows to cascade WebHit shape', () => {
  const { hits, images } = mapYouHits(payload);
  assert.ok(hits.length >= 3);
  assert.equal(hits[0]?.url, 'https://www.amazon.com/Sony-WF-1000XM5-Bluetooth-Canceling-Headphones/dp/B0C33XXS56');
  assert.match(hits[0]?.title ?? '', /Sony WF-1000XM5/);
  assert.ok((hits[0]?.snippet?.length ?? 0) > 20);
  assert.ok(hits[0]?.snippet && hits[0].snippet.length <= 320);
  assert.equal(hits[0]?.date, '2023-07-24T00:00:00');
  assert.ok(images.length >= 1);
  assert.equal(images[0]?.license, 'source');
  assert.match(images[0]?.thumb ?? '', /^https:\/\//);
});

test('parseYouMcpSse skips notifications and reads tools/call text JSON', () => {
  const parsed = parseYouMcpSse(sse);
  assert.equal((parsed.results?.web ?? []).length, (payload.results?.web ?? []).length);
  const { hits } = mapYouHits(parsed);
  assert.equal(hits[0]?.url, mapYouHits(payload).hits[0]?.url);
});

test('parseYouMcpSse surfaces MCP error frames', () => {
  const raw = 'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"quota exceeded"}}\n\n';
  assert.throws(() => parseYouMcpSse(raw), (err: unknown) => {
    assert.ok(err && typeof err === 'object' && 'status' in err);
    assert.equal((err as { status: number }).status, 502);
    return true;
  });
});

test('youKeyPresent reads YOU_API_KEY or YDC_API_KEY', () => {
  assert.equal(youKeyPresent({} as Env), false);
  assert.equal(youKeyPresent({ YOU_API_KEY: '  ' } as Env), false);
  assert.equal(youKeyPresent({ YOU_API_KEY: 'k' } as Env), true);
  assert.equal(youKeyPresent({ YDC_API_KEY: 'k' } as Env), true);
});
