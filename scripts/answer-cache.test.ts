import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { ANSWER_TTL_S, answerCacheUrl, fnv1a, loadSnapshot, normalizeAnswerQuery, saveSnapshot, snapshotKey, storableAnswer, type AnswerStore } from '../shared/answerKey.ts';
import type { AskRef } from '../shared/askAbout.ts';
import { cacheBypass } from '../server/token.ts';
import type { StreamRequest } from '../server/stream.ts';
import type { Send } from '../server/sse.ts';

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts')) {
      return nextResolve(specifier + '.ts', context);
    }
    throw err;
  }
}
`)}`, import.meta.url);

const { serveStream } = await import('../server/answerCache.ts');

function memoryStore(): AnswerStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
}

function memoryCache() {
  const entries = new Map<string, string>();
  const pending: Promise<unknown>[] = [];
  return {
    entries,
    pending,
    cache: {
      async match(req: Request) {
        const body = entries.get(req.url);
        return body === undefined ? undefined : new Response(body);
      },
      async put(req: Request, res: Response) {
        entries.set(req.url, await res.text());
      },
    },
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
  };
}

const search = (query: string, context?: string): StreamRequest => ({ kind: 'search', query, freshness: 'any', context });

const followup = (ref?: AskRef): StreamRequest => ({
  kind: 'followup',
  question: 'What is behind BlueFlame AI\'s 42% revenue growth?',
  original: 'BlueFlame AI',
  search: { query: 'BlueFlame AI', freshness: 'any', results: [], images: [], discussions: [], engines: [] },
  cards: [],
  ref,
});

async function finish(res: Response, pending: Promise<unknown>[]) {
  const text = await res.text();
  await Promise.all(pending);
  return text;
}

test('normalizeAnswerQuery collapses case, space, quotes and trailing punctuation', () => {
  assert.equal(normalizeAnswerQuery('  Kindle  vs Kobo? '), 'kindle vs kobo');
  assert.equal(normalizeAnswerQuery('"Kindle vs Kobo"'), 'kindle vs kobo');
  assert.equal(normalizeAnswerQuery("'hello?'"), 'hello');
  assert.equal(normalizeAnswerQuery('wow?!'), 'wow');
  assert.equal(normalizeAnswerQuery('kindle vs. kobo'), 'kindle vs. kobo');
  assert.equal(normalizeAnswerQuery('Ｋｉｎｄｌｅ\u00a0vs\nKobo'), 'kindle vs kobo');
});

test('answerCacheUrl includes freshness and a context hash only when context is set', () => {
  const plain = answerCacheUrl({ query: '  Kindle  vs Kobo? ', freshness: 'week' });
  assert.equal(plain, 'https://answer-cache.zo.internal/v1-e28?q=kindle%20vs%20kobo&f=week');
  assert.equal(plain.includes('&c='), false);
  const empty = answerCacheUrl({ query: 'Kindle vs Kobo', freshness: 'any', context: '' });
  assert.equal(empty.includes('&c='), false);
  const withContext = answerCacheUrl({ query: 'Kindle vs Kobo', freshness: 'day', context: 'topic' });
  assert.equal(withContext, `https://answer-cache.zo.internal/v1-e28?q=kindle%20vs%20kobo&f=day&c=${fnv1a('topic')}`);
  assert.equal(fnv1a('topic'), fnv1a('topic'));
  assert.notEqual(fnv1a('topic'), fnv1a('other'));
  assert.match(fnv1a('topic'), /^[0-9a-f]{8}$/);
});

test('storableAnswer requires done and a node, and rejects errors and extractive fallbacks', () => {
  const node = { event: 'node', data: { index: 0 } };
  const done = { event: 'done', data: { engine: 'composed' } };
  assert.equal(storableAnswer([node, done]), true);
  assert.equal(storableAnswer([node, done, { event: 'error', data: { message: 'no' } }]), false);
  assert.equal(storableAnswer([done]), false);
  assert.equal(storableAnswer([node, { event: 'done', data: { engine: 'extractive' } }]), false);
  assert.equal(storableAnswer([node]), false);
});

test('snapshots round-trip, expire, and survive a quota error', () => {
  const store = memoryStore();
  const turns = [{ id: 3, question: 'Kindle vs Kobo' }];
  assert.equal(snapshotKey('  Kindle vs Kobo? ', 'week'), 'zo:answer:v1:week:kindle vs kobo');
  assert.equal(saveSnapshot(store, '  Kindle vs Kobo? ', turns, 1_000), true);
  assert.deepEqual(loadSnapshot(store, 'kindle vs kobo', 1_000), turns);
  assert.equal(loadSnapshot(store, 'kindle vs kobo', 1_000 + ANSWER_TTL_S * 1000 + 1), undefined);
  assert.equal(store.getItem(snapshotKey('kindle vs kobo')), null);

  saveSnapshot(store, 'nba scores tonight', turns, 1_000);
  assert.deepEqual(loadSnapshot(store, 'nba scores tonight', 1_000 + 60_000, 300), turns);
  assert.equal(loadSnapshot(store, 'nba scores tonight', 1_000 + 301_000, 300), undefined);
  assert.deepEqual(loadSnapshot(store, 'nba scores tonight', 1_000 + 301_000), turns, 'an offline restore keeps the full day');

  store.setItem(snapshotKey('broken'), '{');
  assert.equal(loadSnapshot(store, 'broken'), undefined);
  store.setItem(snapshotKey('wrong'), JSON.stringify({ v: 2, savedAt: 1, turns: [] }));
  assert.equal(loadSnapshot(store, 'wrong', 1), undefined);

  const quota: AnswerStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => undefined,
  };
  assert.equal(saveSnapshot(quota, 'q', turns), false);
});

test('cache bypass requires both the no-cache header and a valid test token', () => {
  const headers = (extra: Record<string, string>) => new Request('https://zo.page/api/stream', { headers: extra });
  assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' }), {}), false);
  assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'nope' }), { ZO_TEST_TOKEN: 'secret' }), false);
  assert.equal(cacheBypass(headers({ 'x-zo-test-token': 'secret' }), { ZO_TEST_TOKEN: 'secret' }), false);
  assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' }), { ZO_TEST_TOKEN: 'secret' }), true);
});

test('serveStream stores a miss and replays a normalized hit without calling run', async () => {
  const mem = memoryCache();
  let calls = 0;
  const run = async (send: Send) => {
    calls += 1;
    send('node', { index: 0, node: { type: 'text', text: 'hi' } });
    send('done', { engine: 'composed', removed: 0, pagesRead: 1, ms: 4 });
  };
  const first = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: search('Kindle vs Kobo'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(first.headers.get('X-ZO-Cache'), 'MISS');
  const body = await finish(first, mem.pending);
  assert.equal(calls, 1);
  assert.equal(mem.entries.size, 1);
  assert.equal([...mem.entries.values()][0], body);

  const second = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: search('  KINDLE   vs kobo? '),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(second.headers.get('X-ZO-Cache'), 'HIT');
  assert.equal(calls, 1);
  assert.equal(await second.text(), body);
});

test('the saved answer lives as long as its query stays current', async () => {
  const seen: string[] = [];
  const cache = {
    async match() {
      return undefined;
    },
    async put(_req: Request, res: Response) {
      seen.push(res.headers.get('cache-control') ?? '');
    },
  };
  const pending: Promise<unknown>[] = [];
  const run = async (send: Send) => {
    send('node', { index: 0, node: { type: 'text', text: 'hi' } });
    send('done', { engine: 'composed', removed: 0, pagesRead: 1, ms: 4 });
  };
  for (const q of ['Kindle vs Kobo', 'AI news today', 'Lakers live score']) {
    const res = await serveStream({ request: new Request('https://zo.page/api/stream', { method: 'POST' }), env: {}, req: search(q), run, waitUntil: (p) => pending.push(p), cache });
    await finish(res, pending);
  }
  assert.deepEqual(seen, ['public, max-age=86400', 'public, max-age=300', 'public, max-age=30']);
});

test('a pressed Retry skips the saved answer and replaces it with the fresh one', async () => {
  const mem = memoryCache();
  let text = 'old';
  let calls = 0;
  const run = async (send: Send) => {
    calls += 1;
    send('node', { index: 0, node: { type: 'text', text } });
    send('done', { engine: 'composed', removed: 0, pagesRead: 1, ms: 4 });
  };
  const ask = (headers: Record<string, string> = {}) =>
    serveStream({ request: new Request('https://zo.page/api/stream', { method: 'POST', headers }), env: {}, req: search('AI news today'), run, waitUntil: mem.waitUntil, cache: mem.cache });
  await finish(await ask(), mem.pending);
  text = 'new';
  const retried = await ask({ 'x-zo-refresh': '1' });
  assert.equal(retried.headers.get('X-ZO-Cache'), 'REFRESH');
  assert.match(await finish(retried, mem.pending), /new/);
  assert.equal(calls, 2);
  const after = await ask();
  assert.equal(after.headers.get('X-ZO-Cache'), 'HIT');
  assert.match(await after.text(), /new/);
  assert.equal(calls, 2);
});

test('serveStream does not store a stream cancelled before done', async () => {
  const mem = memoryCache();
  let release!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ran = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const res = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: search('cancelled before done'),
    run: async (send) => {
      send('node', { index: 0, node: { type: 'text', text: 'partial' } });
      await gate;
      send('done', { engine: 'composed' });
      finished();
    },
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(res.headers.get('X-ZO-Cache'), 'MISS');
  await res.body?.cancel();
  release();
  await ran;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(mem.pending);
  assert.equal(mem.entries.size, 0);
});

test('serveStream does not store errors, empty dones, or retry attempts', async () => {
  const cases: { name: string; headers?: Record<string, string>; run: (send: Send) => Promise<void> }[] = [
    {
      name: 'error',
      run: async (send) => {
        send('node', { index: 0, node: { type: 'text', text: 'x' } });
        send('error', { message: 'nope', retryable: true });
      },
    },
    {
      name: 'empty-done',
      run: async (send) => {
        send('done', { engine: 'composed' });
      },
    },
    {
      name: 'retry',
      headers: { 'x-zo-retry': '1' },
      run: async (send) => {
        send('node', { index: 0, node: { type: 'text', text: 'x' } });
        send('done', { engine: 'composed' });
      },
    },
  ];
  for (const item of cases) {
    const mem = memoryCache();
    const res = await serveStream({
      request: new Request('https://zo.page/api/stream', { method: 'POST', headers: item.headers }),
      env: {},
      req: search(item.name),
      run: item.run,
      waitUntil: mem.waitUntil,
      cache: mem.cache,
    });
    assert.equal(res.headers.get('X-ZO-Cache'), 'MISS', item.name);
    await finish(res, mem.pending);
    assert.equal(mem.entries.size, 0, item.name);
  }
});

test('no-cache is a hit unless the test token is valid', async () => {
  const mem = memoryCache();
  let calls = 0;
  const run = async (send: Send) => {
    calls += 1;
    send('node', { index: 0, node: { type: 'text', text: 'cached' } });
    send('done', { engine: 'composed' });
  };
  const fill = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: { ZO_TEST_TOKEN: 'secret' },
    req: search('token gate'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  await finish(fill, mem.pending);
  assert.equal(calls, 1);

  const blocked = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST', headers: { 'x-zo-no-cache': '1', 'x-zo-test-token': 'nope' } }),
    env: { ZO_TEST_TOKEN: 'secret' },
    req: search('token gate'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(blocked.headers.get('X-ZO-Cache'), 'HIT');
  await blocked.text();
  assert.equal(calls, 1);

  const missing = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST', headers: { 'x-zo-no-cache': '1' } }),
    env: {},
    req: search('token gate'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(missing.headers.get('X-ZO-Cache'), 'HIT');
  await missing.text();
  assert.equal(calls, 1);

  const opened = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST', headers: { 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' } }),
    env: { ZO_TEST_TOKEN: 'secret' },
    req: search('token gate'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(opened.headers.get('X-ZO-Cache'), 'BYPASS');
  await finish(opened, mem.pending);
  assert.equal(calls, 2);
});

test('design streams are never cached', async () => {
  const mem = memoryCache();
  let calls = 0;
  const res = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: { kind: 'design' } as StreamRequest,
    run: async (send) => {
      calls += 1;
      send('node', { index: 0, node: { type: 'text', text: 'd' } });
      send('done', { engine: 'composed' });
    },
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(res.headers.get('X-ZO-Cache'), 'SKIP');
  await finish(res, mem.pending);
  assert.equal(calls, 1);
  assert.equal(mem.entries.size, 0);
});

test('follow-up streams carrying a ref are never cached', async () => {
  const mem = memoryCache();
  let calls = 0;
  const res = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: followup({ label: 'Revenue growth', value: '42%', entity: 'BlueFlame AI' }),
    run: async (send) => {
      calls += 1;
      send('node', { index: 0, node: { type: 'text', text: 'f' } });
      send('done', { engine: 'composed' });
    },
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  assert.equal(res.headers.get('X-ZO-Cache'), 'SKIP');
  await finish(res, mem.pending);
  assert.equal(calls, 1);
  assert.equal(mem.entries.size, 0);
});

test('a cache hit replays a large body without reparsing it', async () => {
  const mem = memoryCache();
  const text = 'y'.repeat(200_000);
  const run = async (send: Send) => {
    send('node', { index: 0, node: { type: 'text', text } });
    send('done', { engine: 'composed' });
  };
  const miss = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: search('big body'),
    run,
    waitUntil: mem.waitUntil,
    cache: mem.cache,
  });
  const stored = await finish(miss, mem.pending);
  assert.ok(stored.length > 200_000);

  const started = performance.now();
  const hit = await serveStream({
    request: new Request('https://zo.page/api/stream', { method: 'POST' }),
    env: {},
    req: search('big body'),
    run: async () => {
      throw new Error('hit path must not run');
    },
    cache: mem.cache,
  });
  assert.equal(hit.headers.get('X-ZO-Cache'), 'HIT');
  const replay = await hit.text();
  const elapsed = performance.now() - started;
  assert.equal(replay, stored);
  assert.ok(elapsed < 20, `hit took ${elapsed}ms`);
});
