import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseDdgLite } from '../server/backup.ts';
import { clearDeadEngines, engineDead, moreQueries, newLedger, queriesForAsk, rememberDead, searchCalls, SEARCH_CALL_CAP } from '../server/budget.ts';
import { packSearch, readSearchCache, searchCacheKey, writeSearchCache, type CacheDb } from '../server/cache.ts';
import { cascadeWeb } from '../server/cascade.ts';
import { search } from '../server/search.ts';
import { runStream } from '../server/stream.ts';
import { cacheBypass, validTestToken } from '../server/token.ts';
import type { Env } from '../server/util.ts';
import { WIKI_UA, parseWikiSearch } from '../server/wikiSearch.ts';
import type { SearchResponse } from '../shared/types.ts';

const fixture = readFileSync(new URL('./fixtures/ddg-lite.html', import.meta.url), 'utf8');
const wikiFixture = JSON.parse(readFileSync(new URL('./fixtures/wiki-search.json', import.meta.url), 'utf8')) as unknown;
const PAGE = `${'PostgreSQL is an open source database used for reliable storage of application data across many systems. '.repeat(5)}\n`;
const KEY = 'test-exa-key';

function memDb(fail = false): CacheDb & { rows: Map<string, { payload: string; created_at: number }>; prepares: number } {
  const rows = new Map<string, { payload: string; created_at: number }>();
  const db = {
    rows,
    prepares: 0,
    prepare(sql: string) {
      db.prepares += 1;
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (fail) throw new Error('no such table: search_cache');
              if (!sql.startsWith('SELECT')) return null;
              return (rows.get(String(args[0])) as T) ?? null;
            },
            async run() {
              if (fail) throw new Error('no such table: search_cache');
              if (sql.startsWith('INSERT')) rows.set(String(args[0]), { payload: String(args[1]), created_at: Number(args[2]) });
            },
          };
        },
      };
    },
  };
  return db;
}

function hasAuth(init?: RequestInit): boolean {
  const headers = init?.headers;
  if (!headers) return false;
  if (headers instanceof Headers) return !!headers.get('authorization');
  if (Array.isArray(headers)) return false;
  return Boolean((headers as Record<string, string>).Authorization);
}

function install(script: {
  exa?: number | 'ok';
  tavily?: number | 'ok';
  backup?: number | 'ok';
  jina?: number;
  keyless?: number | 'ok';
  langsearch?: number | 'ok';
  firecrawl?: number | 'ok';
  serper?: number | 'ok';
  wikipedia?: number | 'ok' | 'empty';
}) {
  const calls: { url: string; auth: boolean; init?: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = hasAuth(init);
    calls.push({ url, auth, init });
    if (url.includes('api.exa.ai')) {
      if ((script.exa ?? 'ok') === 'ok') {
        return Response.json({
          results: [
            { title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', text: 'short' },
            { title: 'SQLite open source database', url: 'https://sqlite.org/', text: 'short' },
            { title: 'MariaDB open source database', url: 'https://mariadb.org/', text: 'short' },
          ],
        });
      }
      return new Response('payment required', { status: script.exa as number });
    }
    if (url.includes('api.langsearch.com')) {
      if (script.langsearch === 'ok') {
        return Response.json({ code: 200, data: { webPages: { value: [{ name: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', snippet: 'An open source database.' }] } } });
      }
      return new Response('no credit', { status: script.langsearch ?? 402 });
    }
    if (url.includes('api.tavily.com')) {
      if (script.tavily === 'ok') return Response.json({ results: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', content: 'An open source database.' }] });
      return new Response('no credit', { status: script.tavily ?? 432 });
    }
    if (url.includes('api.firecrawl.dev')) {
      if (script.firecrawl === 'ok') return Response.json({ success: true, data: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', description: 'An open source database.' }] });
      return new Response('no credit', { status: script.firecrawl ?? 402 });
    }
    if (url.includes('google.serper.dev')) {
      if (script.serper === 'ok') return Response.json({ organic: [{ title: 'PostgreSQL open source database', link: 'https://www.postgresql.org/', snippet: 'An open source database.' }] });
      return new Response('no credit', { status: script.serper ?? 402 });
    }
    if (url.includes('en.wikipedia.org/w/api.php') && url.includes('srlimit=5')) {
      if (script.wikipedia === 'empty') return Response.json({ query: { search: [] } });
      if ((script.wikipedia ?? 'ok') === 'ok') return Response.json(wikiFixture);
      return new Response('no', { status: script.wikipedia as number });
    }
    if (url.includes('lite.duckduckgo.com')) {
      if ((script.backup ?? 'ok') === 'ok') return new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('no', { status: script.backup as number });
    }
    if (url.startsWith('https://r.jina.ai/')) {
      if (auth) return new Response('payment required', { status: script.jina ?? 402 });
      if ((script.keyless ?? 'ok') === 'ok') return new Response(PAGE, { status: 200 });
      return new Response('no', { status: script.keyless as number });
    }
    return Response.json({});
  };
  const n = (part: string) => calls.filter((c) => c.url.includes(part)).length;
  return {
    calls,
    restore() { globalThis.fetch = orig; },
    counts: () => ({
      exa: n('api.exa.ai'),
      langsearch: n('api.langsearch.com'),
      tavily: n('api.tavily.com'),
      firecrawl: n('api.firecrawl.dev'),
      serper: n('google.serper.dev'),
      wiki: calls.filter((c) => c.url.includes('srlimit=5')).length,
      backup: n('lite.duckduckgo.com'),
      jina: calls.filter((c) => c.url.startsWith('https://r.jina.ai/') && c.auth).length,
      keyless: calls.filter((c) => c.url.startsWith('https://r.jina.ai/') && !c.auth).length,
    }),
  };
}

const env = (extra: Record<string, unknown> = {}): Env => ({ EXA_API_KEY: KEY, TAVILY_API_KEY: 'tv', JINA_API_KEY: 'jk', ...extra }) as Env;

async function ask(query = 'open source database', extra: Record<string, unknown> = {}, request?: Request) {
  const events: string[] = [];
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map((a) => String(a)).join(' ')); };
  try {
    await runStream({ kind: 'search', query, freshness: 'any' }, env(extra), (event) => { events.push(event); }, { request });
  } finally {
    console.log = orig;
  }
  const line = logs.find((l) => l.includes('"zo":"calls"'));
  return { events, logs, line };
}

function callLine(line: string) {
  return JSON.parse(line) as {
    search: { exa: number; langsearch: number; tavily: number; firecrawl: number; serper: number; wikipedia: number; backup: number };
    cache: string;
    pages: { jina: number; keyless: number; direct: number };
    fellThrough: string[];
  };
}

describe('runway', { concurrency: 1 }, () => {
  test('cache key normalization and bypass token', () => {
    assert.equal(searchCacheKey('  Foo   BAR ', 'day', 20), searchCacheKey('foo bar', 'day', 20));
    assert.notEqual(searchCacheKey('foo', 'day', 20), searchCacheKey('foo', 'week', 20));
    assert.notEqual(searchCacheKey('foo', 'day', 20), searchCacheKey('foo', 'day', 8));
    assert.equal(queriesForAsk('news tldr today', ['top headlines today', 'tldr news site']), 'news tldr today');
    assert.deepEqual(moreQueries('news tldr today', ['top headlines today', 'tldr news site']), ['top headlines today', 'tldr news site']);
    assert.equal(queriesForAsk('  Foo   Bar ', []), 'Foo Bar');
    assert.equal(queriesForAsk('foo', ['foo', 'FOO']), 'foo');
    assert.deepEqual(moreQueries('foo', ['foo', 'FOO', 'bar']), ['bar']);
    assert.equal(validTestToken('secret', undefined), false);
    assert.equal(validTestToken('nope', 'secret'), false);
    assert.equal(validTestToken('secret', 'secret'), true);
    const headers = (h: Record<string, string>) => new Request('https://zo.page/api/stream', { headers: h });
    assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' }), {}), false);
    assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'nope' }), { ZO_TEST_TOKEN: 'secret' }), false);
    assert.equal(cacheBypass(headers({ 'x-zo-test-token': 'secret' }), { ZO_TEST_TOKEN: 'secret' }), false);
    assert.equal(cacheBypass(headers({ 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' }), { ZO_TEST_TOKEN: 'secret' }), true);
  });

  test('backup parser reads the captured lite page', () => {
    const hits = parseDdgLite(fixture);
    assert.ok(hits.length >= 5);
    assert.ok(hits.some((h) => h.url.includes('postgresql.org')));
    assert.ok(hits.some((h) => /postgres/i.test(h.title)));
    assert.equal(parseDdgLite(fixture.slice(0, 32_768)).length, hits.length);
  });

  test('dead engine memory expires and skips a call', () => {
    clearDeadEngines();
    rememberDead('exa', 1_000);
    assert.equal(engineDead('exa', 1_000 + 60_000), true);
    assert.equal(engineDead('exa', 1_000 + 11 * 60_000), false);
    clearDeadEngines();
  });

  test('Tavily 432 and Jina 402 still answer through Exa, within the call cap', async () => {
    clearDeadEngines();
    const net = install({ exa: 'ok', tavily: 432, jina: 402, keyless: 'ok' });
    try {
      const { events, line, logs } = await ask();
      assert.ok(line, logs.join('\n'));
      assert.equal(logs.filter((l) => l.includes('"zo":"calls"')).length, 1);
      assert.equal(line!.includes('open source database'), false);
      assert.equal(line!.includes(KEY), false);
      assert.equal(line!.includes('jk'), false);
      const parsed = callLine(line!);
      assert.equal(parsed.search.exa, 1);
      assert.equal(parsed.search.tavily, 0);
      assert.equal(parsed.search.backup, 0);
      assert.equal(parsed.search.wikipedia, 1);
      assert.equal(net.counts().wiki, 1);
      assert.equal(net.counts().langsearch, 0);
      assert.equal(net.counts().firecrawl, 0);
      assert.equal(net.counts().serper, 0);
      const exaCall = net.calls.find((c) => c.url.includes('api.exa.ai'));
      const exaBody = JSON.parse(String(exaCall?.init?.body)) as { type?: string; numResults?: number; contents?: { text?: { maxCharacters?: number } } };
      assert.equal(exaBody.type, 'fast');
      assert.equal(exaBody.numResults, 10);
      assert.equal(exaBody.contents?.text?.maxCharacters, 6000);
      const wikiCall = net.calls.find((c) => c.url.includes('srlimit=5'));
      const wikiHeaders = wikiCall?.init?.headers as Record<string, string>;
      assert.equal(wikiHeaders['User-Agent'], WIKI_UA);
      assert.ok(searchCalls(parsed) <= SEARCH_CALL_CAP);
      assert.ok(parsed.pages.jina >= 1);
      assert.ok(parsed.pages.keyless >= 1);
      assert.equal(events.includes('done'), true);
      assert.equal(events.includes('error'), false);
      assert.equal(net.counts().tavily, 0);
    } finally {
      net.restore();
      clearDeadEngines();
    }
  });

  test('Exa and Tavily down: backup answers, then dead memory skips them', async () => {
    clearDeadEngines();
    const net = install({ exa: 402, tavily: 432, wikipedia: 'ok', jina: 402 });
    try {
      const first = await ask();
      const parsed = callLine(first.line!);
      assert.equal(first.events.includes('done'), true);
      assert.equal(parsed.search.exa, 1);
      assert.equal(parsed.search.tavily, 1);
      assert.equal(parsed.search.wikipedia, 1);
      assert.equal(parsed.search.backup, 0);
      assert.equal(net.counts().backup, 0);
      assert.ok(searchCalls(parsed) <= SEARCH_CALL_CAP);
      assert.ok(parsed.fellThrough.some((f) => f.startsWith('exa:')));
      assert.ok(parsed.fellThrough.some((f) => f.startsWith('tavily:')));
      net.calls.length = 0;
      const second = await ask('sqlite open source database');
      const again = callLine(second.line!);
      assert.equal(second.events.includes('done'), true);
      assert.equal(again.search.exa, 0);
      assert.equal(again.search.tavily, 0);
      assert.equal(again.search.wikipedia, 1);
      assert.equal(again.search.backup, 0);
      assert.equal(net.counts().exa, 0);
      assert.equal(net.counts().tavily, 0);
      assert.equal(net.counts().backup, 0);
      assert.ok(again.fellThrough.includes('exa:skipped'));
      assert.ok(again.fellThrough.includes('tavily:skipped'));
    } finally {
      net.restore();
      clearDeadEngines();
    }
  });

  test('search cap stops further calls', async () => {
    clearDeadEngines();
    const net = install({ exa: 500, tavily: 500, wikipedia: 500, backup: 500 });
    try {
      await assert.rejects(() => ask(), /No results/);
      const ledger = newLedger();
      ledger.search.exa = SEARCH_CALL_CAP;
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env(), ledger);
      assert.equal(out.hits.length, 0);
      assert.equal(net.counts().exa + net.counts().tavily + net.counts().wiki + net.counts().backup, 3);
      assert.ok(ledger.fellThrough.some((f) => f.endsWith(':cap')));
    } finally {
      net.restore();
      clearDeadEngines();
    }
  });

  test('cache hit, miss, no-op, and token bypass', async () => {
    clearDeadEngines();
    const net = install({ exa: 'ok' });
    try {
      const bare = newLedger();
      const missed = await search({ q: 'open source database', freshness: 'any', count: 8 }, env(), { ledger: bare, bypass: false });
      assert.equal(bare.cache, 'off');
      assert.ok(missed.results.length > 0);
      assert.equal(net.counts().exa, 1);

      const broken = memDb(true);
      const off = newLedger();
      const still = await search({ q: 'open source database', freshness: 'any', count: 8 }, env({ DB: broken }), { ledger: off, bypass: false });
      assert.equal(off.cache, 'off');
      assert.ok(still.results.length > 0);

      const db = memDb();
      const key = searchCacheKey('open source database', 'any', 8);
      db.rows.set(key, {
        payload: JSON.stringify({
          query: 'open source database',
          freshness: 'any',
          results: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', snippet: 'open source database', domain: 'postgresql.org', engines: ['exa'] }],
          images: [],
          discussions: [],
          engines: [],
        }),
        created_at: Date.now(),
      });
      const before = net.counts().exa;
      const hitLedger = newLedger();
      const hit = await search({ q: '  Open   Source   database ', freshness: 'any', count: 8 }, env({ DB: db }), { ledger: hitLedger, bypass: false });
      assert.equal(hitLedger.cache, 'hit');
      assert.equal(net.counts().exa, before);
      assert.equal(hit.results[0]?.url.includes('postgresql.org'), true);

      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => { release = r; });
      const fresh: CacheDb & { rows: Map<string, { payload: string; created_at: number }>; prepares: number } = {
        rows: new Map(),
        prepares: 0,
        prepare(sql: string) {
          fresh.prepares += 1;
          return {
            bind(...args: unknown[]) {
              return {
                async first<T>(): Promise<T | null> {
                  if (!sql.startsWith('SELECT')) return null;
                  return (fresh.rows.get(String(args[0])) as T) ?? null;
                },
                async run() {
                  await gate;
                  if (sql.startsWith('INSERT')) fresh.rows.set(String(args[0]), { payload: String(args[1]), created_at: Number(args[2]) });
                },
              };
            },
          };
        },
      };
      const missLedger = newLedger();
      let pending: Promise<unknown> | undefined;
      const stored = await search({ q: 'mariadb open source database', freshness: 'any', count: 8 }, env({ DB: fresh }), {
        ledger: missLedger,
        bypass: false,
        waitUntil: (p) => { pending = p; },
      });
      assert.equal(missLedger.cache, 'miss');
      assert.ok(stored.results.length > 0);
      assert.equal(fresh.rows.size, 0);
      assert.ok(pending);
      release();
      await pending;
      assert.equal(fresh.rows.size, 1);
      const payload = [...fresh.rows.values()][0].payload;
      assert.ok(payload.length <= 32_000);
      assert.equal(payload.includes(KEY), false);

      const skip = memDb();
      const bypassLedger = newLedger();
      await search({ q: 'open source database', freshness: 'any', count: 8 }, env({ DB: skip }), { ledger: bypassLedger, bypass: true });
      assert.equal(bypassLedger.cache, 'bypass');
      assert.equal(skip.prepares, 0);

      const closed = memDb();
      const ignored = await ask('redis open source database', { DB: closed }, new Request('https://zo.page/api/stream', { headers: { 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' } }));
      assert.notEqual(callLine(ignored.line!).cache, 'bypass');
      assert.ok(closed.prepares > 0);
      const open = memDb();
      const honored = await ask('redis open source database', { DB: open, ZO_TEST_TOKEN: 'secret' }, new Request('https://zo.page/api/stream', { headers: { 'x-zo-no-cache': '1', 'x-zo-test-token': 'secret' } }));
      assert.equal(callLine(honored.line!).cache, 'bypass');
      assert.equal(open.prepares, 0);
    } finally {
      net.restore();
      clearDeadEngines();
    }
  });

  test('Wikipedia rides with a keyed hit and one planner rewrite is a second call', async () => {
    clearDeadEngines();
    const net = install({ exa: 'ok', wikipedia: 'ok' });
    try {
      const ledger = newLedger();
      const out = await cascadeWeb({ q: 'planner query about postgres', more: ['open source database'], freshness: 'any', count: 8 }, env(), ledger);
      assert.equal(ledger.search.exa, 2);
      assert.equal(ledger.search.wikipedia, 1);
      assert.equal(ledger.search.tavily, 0);
      assert.ok(searchCalls(ledger) <= SEARCH_CALL_CAP);
      assert.equal(out.engine, 'exa');
      assert.equal(out.hits.some((h) => h.url.includes('wikipedia.org')), false);
      assert.ok(out.wikiHits.some((h) => h.url.includes('wikipedia.org')));
      assert.equal(out.hits[0]?.url.includes('postgresql.org'), true);
      const found = await search({ q: 'open source database', freshness: 'any', count: 8 }, env(), { ledger: newLedger(), bypass: true });
      const urls = found.results.map((r) => r.url);
      const engineAt = urls.findIndex((u) => u.includes('postgresql.org'));
      const wikiAt = urls.findIndex((u) => u.includes('wikipedia.org'));
      assert.ok(engineAt >= 0 && wikiAt > engineAt);
      const typed = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env({ EXA_SEARCH_TYPE: 'instant', TAVILY_API_KEY: '' }), newLedger());
      assert.equal(typed.engine, 'exa');
      const bodies = net.calls.filter((c) => c.url.includes('api.exa.ai')).map((c) => JSON.parse(String(c.init?.body)) as { type?: string });
      assert.equal(bodies.at(-1)?.type, 'instant');
    } finally {
      net.restore();
      clearDeadEngines();
    }
  });

  test('two planner rewrites stay inside the cap and each list is ranked on its own words', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.exa.ai')) {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.startsWith('bose')) {
          return Response.json({ results: [{ title: 'Bose QuietComfort Ultra price', url: 'https://www.whathifi.com/bose', text: 'Bose QuietComfort Ultra Earbuds cost $299.' }] });
        }
        if (body.query.includes('150')) {
          return Response.json({ results: [{ title: 'minutes deal roundup', url: 'https://deal.example/minutes', text: 'A sale page that mentions 150 minutes and nothing about guidelines.' }] });
        }
        return Response.json({
          results: [{ title: 'WHO guidelines on physical activity and sedentary behaviour', url: 'https://bjsm.bmj.com/who-2020', text: 'All adults should undertake 150–300 min of moderate intensity, or 75–150 min of vigorous-intensity physical activity.' }],
        });
      }
      if (url.includes('en.wikipedia.org')) return Response.json({ query: { search: [{ title: 'Physical activity', snippet: 'Exercise' }] } });
      return Response.json({});
    };
    try {
      const ledger = newLedger();
      const found = await search({
        q: 'bose quietcomfort ultra earbuds current price',
        more: ['WHO physical activity guidelines adults 150 minutes primary source', 'WHO Guidelines on physical activity and sedentary behaviour adults'],
        freshness: 'any',
        count: 8,
      }, env(), { ledger, bypass: true });
      assert.equal(ledger.search.exa, 3);
      assert.equal(ledger.search.wikipedia, 0);
      assert.ok(searchCalls(ledger) <= SEARCH_CALL_CAP);
      const urls = found.results.map((r) => r.url);
      assert.equal(urls[0], 'https://www.whathifi.com/bose');
      assert.ok(urls.includes('https://bjsm.bmj.com/who-2020'));
      assert.equal(urls.includes('https://deal.example/minutes'), false);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('call-cut merged list is diversified after the engine and Wikipedia are de-duplicated', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const page = (host: string, n: number) => ({ title: `compare database engines ${n}`, url: `https://${host}/${n}`, text: 'compare database engines' });
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.exa.ai')) {
        return Response.json({
          results: [page('reviews.example.com', 1), page('reviews.example.com', 2), page('reviews.example.com', 3), page('reviews.example.com', 4), page('notes.other.test', 1)],
        });
      }
      if (url.includes('en.wikipedia.org/w/api.php') && url.includes('srlimit=5')) {
        const row = (title: string) => ({ ns: 0, title, snippet: 'compare database engines' });
        return Response.json({ query: { search: [row('Alpha compare'), row('Beta compare'), row('Gamma compare')] } });
      }
      return Response.json({});
    };
    try {
      const found = await search({ q: 'compare database engines', freshness: 'any', count: 8 }, env(), { ledger: newLedger(), bypass: true });
      assert.deepEqual(found.results.map((r) => r.domain), [
        'reviews.example.com', 'reviews.example.com', 'notes.other.test',
        'en.wikipedia.org', 'en.wikipedia.org',
        'reviews.example.com', 'reviews.example.com', 'en.wikipedia.org',
      ]);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('cpu bench for cache and backup parse', async () => {
    const n = 40;
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < n; i++) hits += parseDdgLite(fixture).length;
    const parseMs = (performance.now() - t0) / n;
    const tWiki = performance.now();
    let wikiHits = 0;
    for (let i = 0; i < n; i++) wikiHits += parseWikiSearch(wikiFixture).length;
    const wikiMs = (performance.now() - tWiki) / n;
    const sample: SearchResponse = {
      query: 'open source database',
      freshness: 'any',
      results: Array.from({ length: 8 }, (_, i) => ({
        title: `Open source database ${i}`,
        url: `https://example.com/${i}`,
        snippet: 'An open source database used for reliable storage.',
        domain: 'example.com',
        engines: ['exa'],
        content: 'body '.repeat(80),
      })),
      images: [],
      discussions: [],
      engines: [{ name: 'exa', ok: true, count: 8, ms: 1 }],
    };
    const payload = packSearch(sample);
    assert.ok(payload.length <= 32_000);
    const db = memDb();
    await writeSearchCache(db, 'bench', payload);
    const t1 = performance.now();
    for (let i = 0; i < n; i++) await readSearchCache(db, 'bench');
    const hitMs = (performance.now() - t1) / n;
    const t2 = performance.now();
    for (let i = 0; i < n; i++) await readSearchCache(db, 'missing');
    const missMs = (performance.now() - t2) / n;
    const t3 = performance.now();
    for (let i = 0; i < n; i++) await writeSearchCache(db, `k${i}`, payload);
    const writeMs = (performance.now() - t3) / n;
    console.log(`bench backup-parse ${parseMs.toFixed(3)} ms/call`);
    console.log(`bench wiki-parse ${wikiMs.toFixed(3)} ms/call`);
    console.log(`bench cache-hit ${hitMs.toFixed(3)} ms/call`);
    console.log(`bench cache-miss ${missMs.toFixed(3)} ms/call`);
    console.log(`bench cache-write ${writeMs.toFixed(3)} ms/call`);
    assert.ok(hits > 0);
    assert.ok(wikiHits > 0);
    assert.ok(wikiMs < 5);
    assert.ok(parseMs < 10);
    assert.ok(hitMs < 5);
  });
});
