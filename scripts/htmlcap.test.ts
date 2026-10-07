import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAGE_HTML_CAP, readPage, trimCut } from '../server/htmlcap.ts';

function chunked(source: string, chunkSize: number) {
  const encoded = new TextEncoder().encode(source);
  let offset = 0;
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      const n = Math.min(chunkSize, encoded.length - offset);
      controller.enqueue(encoded.subarray(offset, offset + n));
      offset += n;
      pulled += 1;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    total: Math.ceil(encoded.length / chunkSize),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

test('stops a 600KB body at main instead of reading every chunk', async () => {
  const total = 600 * 1024;
  const chunkSize = 16 * 1024;
  const mainAt = 10 * 1024;
  const html = `${'a'.repeat(mainAt)}<main>${'b'.repeat(total - mainAt - '<main>'.length)}`;
  const body = chunked(html, chunkSize);
  const page = await readPage(new Response(body.stream));
  assert.ok(page.body.length <= PAGE_HTML_CAP);
  assert.ok(page.body.startsWith('<main'));
  assert.ok(body.cancelled() || body.pulled() < body.total);
});

test('windows a main tag that starts after a 300KB head', async () => {
  const mainAt = 320_000;
  const head = `<!DOCTYPE html><html><head><script>${'s'.repeat(300_000)}</script></head><body>`;
  const article = '<main><p>Melt the butter.</p></main>';
  const html = head + ' '.repeat(mainAt - head.length) + article + '</body></html>';
  assert.equal(html.indexOf('<main'), mainAt);
  const page = await readPage(new Response(html));
  assert.ok(page.body.startsWith('<main'));
  assert.ok(page.body.includes('Melt the butter.'));
  assert.ok(page.body.length <= PAGE_HTML_CAP);
});

test('uses body when the page has no main or article', async () => {
  const bodyAt = 50_000;
  const html = `${'h'.repeat(bodyAt)}<body><p>News copy.</p></body></html>`;
  const page = await readPage(new Response(html));
  assert.ok(page.body.startsWith('<body'));
  assert.ok(page.body.includes('News copy.'));
});

test('keeps the start when the page has no anchor', async () => {
  const page = await readPage(new Response('a'.repeat(200_000)));
  assert.ok(page.body.length <= PAGE_HTML_CAP);
  assert.equal(page.body, 'a'.repeat(page.body.length));
  assert.ok(page.body.length > 0);
});

test('returns a small page whole, from the anchor, without cutting', async () => {
  const html = `<!DOCTYPE html><html><head><title>Hi</title></head><body>${'x'.repeat(2048)}</body></html>`;
  const page = await readPage(new Response(html));
  const anchor = html.indexOf('<body');
  assert.equal(page.cut, false);
  assert.equal(page.body, html.slice(anchor));
  assert.equal(page.head + page.body, html);
});

test('finds an uppercase MAIN anchor', async () => {
  const html = '<!DOCTYPE html><html><head><title>Hi</title></head><body><MAIN><p>Upper</p></MAIN></body></html>';
  const page = await readPage(new Response(html));
  assert.ok(page.body.startsWith('<MAIN'));
  assert.ok(page.body.includes('Upper'));
});

test('finds a main tag split across two chunks', async () => {
  const parts = [`${'x'.repeat(30)}<ma`, 'in><p>Split article</p></main>'];
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(parts[i]!));
      i += 1;
    },
  });
  const page = await readPage(new Response(stream));
  assert.ok(page.body.startsWith('<main'));
  assert.ok(page.body.includes('Split article'));
});

test('trimCut drops an unclosed script and a trailing partial tag', () => {
  const script = '<html><body><p>Hello</p><script src="a.js">broken';
  assert.equal(trimCut(script), '<html><body><p>Hello</p>');

  const partial = '<html><body><p>Hello</p><div class="card';
  assert.equal(trimCut(partial), '<html><body><p>Hello</p>');

  const complete = '<html><head><script>ok()</script></head><body><p>Hello</p></body></html>';
  assert.equal(trimCut(complete), complete);
});
