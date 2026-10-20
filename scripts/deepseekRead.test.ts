import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageText } from '../server/pages.ts';

const page = 'Renewal by mail costs $130 for a passport book. '.repeat(20);

async function withFetch<T>(handler: (url: string) => Response | Promise<Response>, run: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('a page is read through DeepSeek fetch first', async () => {
  await withFetch(
    (url) => (url.endsWith('/v1/tools/fetch') ? new Response(JSON.stringify({ title: 'Renew', content: page })) : new Response('blocked', { status: 403 })),
    async (calls) => {
      const read = await pageText('https://travel.state.gov/en/passports/renew-replace/mail.html', { DEEPSEEK_API_KEY: 'k', JINA_API_KEY: 'j' } as never, 4000);
      assert.match(read, /\$130/);
      assert.ok(calls.includes('https://api.deepseek.com/v1/tools/fetch'));
      assert.ok(!calls.some((url) => url.startsWith('https://r.jina.ai/')), 'Jina is not needed when DeepSeek reads the page');
    },
  );
});

test('a DeepSeek miss falls through to the other readers', async () => {
  await withFetch(
    (url) => (url.endsWith('/v1/tools/fetch') ? new Response(JSON.stringify({ content: '' })) : url.startsWith('https://r.jina.ai/') ? new Response(page) : new Response('no', { status: 403 })),
    async (calls) => {
      const read = await pageText('https://www.usa.gov/renew-adult-passport', { DEEPSEEK_API_KEY: 'k' } as never, 4000);
      assert.match(read, /\$130/);
      assert.ok(calls.some((url) => url.startsWith('https://r.jina.ai/')));
    },
  );
});

test('a direct fetch that returns first wins while DeepSeek is still reading', async () => {
  const html = `<html><body><main><p>${page}</p></main></body></html>`;
  await withFetch(
    (url) => (url.endsWith('/v1/tools/fetch')
      ? new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ content: 'late' }))), 1500)) as never
      : new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })),
    async () => {
      const started = Date.now();
      const read = await pageText('https://www.usa.gov/renew-adult-passport', { DEEPSEEK_API_KEY: 'k' } as never, 4000);
      assert.match(read, /\$130/);
      assert.ok(Date.now() - started < 1000, 'did not wait for DeepSeek');
    },
  );
});
