import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageText } from '../server/pages.ts';

test('with both Jina readers out, a page is read from Exa before a direct fetch', async () => {
  const until = Date.now() + 3_600_000;
  const kv = { get: async () => JSON.stringify({ jina: { until, reason: 'payment' }, 'jina-keyless': { until, reason: 'quota' } }), put: async () => undefined };
  const text = 'Renewal by mail costs $130 for a passport book. '.repeat(20);
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://api.exa.ai/contents') return new Response(JSON.stringify({ results: [{ text }] }), { status: 200 });
    return new Response('blocked', { status: 403 });
  }) as typeof fetch;
  try {
    const read = await pageText('https://travel.state.gov/en/passports/renew-replace/mail.html', { EXA_API_KEY: 'k', JINA_API_KEY: 'j', ENGINE_SKIP: kv } as never, 3000);
    assert.match(read, /\$130/);
    assert.ok(!calls.some((url) => url.startsWith('https://r.jina.ai/')), 'Jina is skipped');
    assert.ok(!calls.includes('https://travel.state.gov/en/passports/renew-replace/mail.html'), 'no direct fetch was needed');
  } finally {
    globalThis.fetch = real;
  }
});
