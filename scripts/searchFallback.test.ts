import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDeadEngines, failureOf, newLedger } from '../server/budget.ts';
import { cascadeWeb } from '../server/cascade.ts';
import { loadSkips } from '../server/engineSkip.ts';
import { keyedEngines } from '../server/search.ts';
import { clip, HttpStatusError, type Env } from '../server/util.ts';
import { cleanMarkdown } from '../shared/text.ts';

const PAGE = `${'PostgreSQL is an open source database used for reliable storage of application data across many systems. '.repeat(6)}`;

function kvStore(initial: string | null = null) {
  const puts: { key: string; value: string; opts?: { expirationTtl?: number } }[] = [];
  let saved = initial;
  let gets = 0;
  const kv = {
    async get(key: string) {
      gets += 1;
      return key === 'engine-skip:v1' ? saved : null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      saved = value;
      puts.push({ key, value, opts });
    },
  };
  return { kv, puts, gets: () => gets };
}

describe('search fallback', { concurrency: 1 }, () => {
  test('LangSearch maps text and a string error code is quota', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const calls: { url: string; body?: string }[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.includes('api.langsearch.com')) {
        const asked = JSON.parse(String(init?.body)) as { query?: string };
        if (asked.query === 'quota case') return Response.json({ code: '429', message: 'quota exceeded' });
        return Response.json({
          code: 200,
          data: {
            webPages: {
              value: [
                { name: 'PostgreSQL', url: 'https://www.postgresql.org/', snippet: 'An open source database.', text: PAGE },
                { name: 'SQLite', url: 'https://sqlite.org/', text: PAGE },
              ],
            },
          },
        });
      }
      return Response.json({});
    };
    try {
      const ledger = newLedger();
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, { LANGSEARCH_API_KEY: 'l' } as Env, ledger);
      const body = JSON.parse(calls.find((c) => c.url.includes('api.langsearch.com'))?.body ?? '{}') as { contents?: { text?: { maxCharacters?: number } } };
      assert.equal(body.contents?.text?.maxCharacters, 6000);
      assert.equal(out.engine, 'langsearch');
      assert.equal(out.hits[0]?.snippet, 'An open source database.');
      assert.equal(out.hits[0]?.content, cleanMarkdown(PAGE));
      assert.ok((out.hits[0]?.content?.length ?? 0) > 300);
      assert.equal(out.hits[1]?.snippet, clip(cleanMarkdown(PAGE), 320));
      assert.equal(out.hits[1]?.content, cleanMarkdown(PAGE));
      assert.equal(ledger.bonus, undefined);

      clearDeadEngines();
      const failed = newLedger();
      const none = await cascadeWeb({ q: 'quota case', freshness: 'any', count: 8 }, { LANGSEARCH_API_KEY: 'l' } as Env, failed);
      assert.equal(none.engine === 'langsearch', false);
      assert.ok(failed.fellThrough.includes('langsearch:quota'));
      assert.equal(none.statuses.find((s) => s.name === 'langsearch')?.error, 'quota');
      assert.equal(failureOf(new HttpStatusError(429, 'quota exceeded')).reason, 'quota');
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('Serper relative dates become ISO', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const before = Date.now();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('google.serper.dev')) {
        return Response.json({
          organic: [
            { title: 'Two days', link: 'https://example.com/days', snippet: 'days', date: '2 days ago' },
            { title: 'Three hours', link: 'https://example.com/hours', snippet: 'hours', date: '3 hours ago' },
            { title: 'Named day', link: 'https://example.com/oct', snippet: 'oct', date: 'Oct 5, 2026' },
            { title: 'No date', link: 'https://example.com/none', snippet: 'none', date: 'recently' },
          ],
        });
      }
      return Response.json({});
    };
    try {
      const allow = { prepare() { return { bind() { return { async first() { return { count: 1 }; } }; } }; } };
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, { SERPER_API_KEY: 's', DB: allow } as Env, newLedger());
      const after = Date.now();
      const byUrl = new Map(out.hits.map((h) => [h.url, h.date]));
      const days = Date.parse(byUrl.get('https://example.com/days') ?? '');
      const hours = Date.parse(byUrl.get('https://example.com/hours') ?? '');
      assert.match(byUrl.get('https://example.com/days') ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.match(byUrl.get('https://example.com/hours') ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(days >= before - 2 * 86_400_000 - 1000 && days <= after - 2 * 86_400_000 + 1000);
      assert.ok(hours >= before - 3 * 3_600_000 - 1000 && hours <= after - 3 * 3_600_000 + 1000);
      assert.equal(byUrl.get('https://example.com/oct'), '2026-10-05T00:00:00.000Z');
      assert.equal(byUrl.get('https://example.com/none'), undefined);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('a 400 credit error is a dead quota failure', () => {
    assert.deepEqual(failureOf(new HttpStatusError(400, 'Not enough credits')), { fall: true, dead: true, reason: 'quota' });
    assert.deepEqual(failureOf(new HttpStatusError(400, 'bad query')), { fall: false, dead: false, reason: 'http400' });
    assert.equal(failureOf(new HttpStatusError(402, 'payment required')).reason, 'payment');
  });

  test('Exa payment falls through to LangSearch and trips the skip', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const store = kvStore();
    const queued: Promise<unknown>[] = [];
    let exaAnswers = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.exa.ai')) {
        const body = JSON.parse(String(init?.body)) as { query?: string };
        if (exaAnswers && body.query !== 'extra query') {
          return Response.json({ results: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', text: 'short' }] });
        }
        return new Response('payment required', { status: 402 });
      }
      if (url.includes('api.langsearch.com')) {
        return Response.json({ code: 200, data: { webPages: { value: [{ name: 'PostgreSQL', url: 'https://www.postgresql.org/', snippet: 'An open source database.' }] } } });
      }
      return Response.json({});
    };
    try {
      const ledger = newLedger();
      const env = { EXA_DAILY_CAP: 'off', EXA_API_KEY: 'e', LANGSEARCH_API_KEY: 'l', SEARCH_ORDER: 'exa,langsearch', ENGINE_SKIP: store.kv } as Env;
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env, ledger, (p) => { queued.push(p); });
      assert.equal(out.engine, 'langsearch');
      assert.equal(out.hits[0]?.url, 'https://www.postgresql.org/');
      assert.ok(ledger.fellThrough.includes('exa:payment'));
      assert.equal(ledger.bonus, 2);
      assert.equal(queued.length, 1);
      await queued[0];
      assert.equal(store.puts.length, 1);
      assert.equal(store.puts[0]?.key, 'engine-skip:v1');
      assert.equal(store.puts[0]?.opts?.expirationTtl, 600);
      const saved = JSON.parse(store.puts[0]?.value ?? '{}') as { exa?: { until?: number; reason?: string } };
      assert.equal(saved.exa?.reason, 'payment');
      assert.ok((saved.exa?.until ?? 0) > Date.now() + 9 * 60_000);

      clearDeadEngines();
      exaAnswers = true;
      const again = kvStore();
      const extraQueued: Promise<unknown>[] = [];
      const extraLedger = newLedger();
      const extraEnv = { SEARCH_ORDER: 'serper,langsearch,exa,tavily,firecrawl,wikipedia,backup', EXA_DAILY_CAP: 'off', EXA_API_KEY: 'e', ENGINE_SKIP: again.kv } as Env;
      const kept = await cascadeWeb(
        { q: 'open source database', more: ['extra query'], freshness: 'any', count: 8 },
        extraEnv,
        extraLedger,
        (p) => { extraQueued.push(p); },
      );
      await Promise.all(extraQueued);
      assert.equal(kept.engine, 'exa');
      assert.equal(extraLedger.bonus, undefined);
      const extraSaved = JSON.parse(again.puts.at(-1)?.value ?? '{}') as { exa?: { reason?: string } };
      assert.equal(extraSaved.exa?.reason, 'payment');
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('without LangSearch or Serper keys the chain matches today', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.exa.ai')) {
        return Response.json({ results: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', text: 'short' }] });
      }
      if (url.includes('en.wikipedia.org')) {
        return Response.json({ query: { search: [{ title: 'PostgreSQL', snippet: 'database' }] } });
      }
      return new Response('no', { status: 500 });
    };
    try {
      const env = { SEARCH_ORDER: 'serper,langsearch,exa,tavily,firecrawl,wikipedia,backup', EXA_DAILY_CAP: 'off', EXA_API_KEY: 'e', TAVILY_API_KEY: 't' } as Env;
      assert.equal(keyedEngines(env).includes('langsearch'), false);
      assert.equal(keyedEngines(env).includes('firecrawl'), false);
      assert.deepEqual(
        keyedEngines({ ...env, LANGSEARCH_API_KEY: 'l', FIRECRAWL_API_KEY: 'f' } as Env).filter((name) => name === 'langsearch' || name === 'firecrawl'),
        ['langsearch', 'firecrawl'],
      );
      const ok = newLedger();
      const hit = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env, ok);
      assert.equal(hit.engine, 'exa');
      assert.equal(ok.bonus, undefined);
      assert.deepEqual(ok.search, { exa: 1, langsearch: 0, tavily: 0, firecrawl: 0, serper: 0, you: 0, 'you-keyless': 0, wikipedia: 1, backup: 0 });

      clearDeadEngines();
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.exa.ai')) return new Response('payment required', { status: 402 });
        if (url.includes('api.tavily.com')) return new Response('no credit', { status: 432 });
        if (url.includes('en.wikipedia.org')) return Response.json({ query: { search: [{ title: 'PostgreSQL', snippet: 'database' }] } });
        return new Response('no', { status: 500 });
      };
      const down = newLedger();
      const fallback = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env, down);
      assert.equal(fallback.engine, 'wikipedia');
      assert.deepEqual(down.search, { exa: 1, langsearch: 0, tavily: 1, firecrawl: 0, serper: 0, you: 0, 'you-keyless': 0, wikipedia: 1, backup: 0 });
      assert.deepEqual(down.fellThrough.filter((f) => !f.startsWith('wikipedia:')), ['exa:payment', 'tavily:unavailable']);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });

  test('a live skip blocks that engine without a fetch', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const until = Date.now() + 60_000;
    const store = kvStore(JSON.stringify({
      exa: { until, reason: 'payment' },
      tavily: { until: Date.now() - 1000, reason: 'quota' },
    }));
    const seen: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('api.langsearch.com')) {
        return Response.json({ code: 200, data: { webPages: { value: [{ name: 'PostgreSQL', url: 'https://www.postgresql.org/', snippet: 'An open source database.' }] } } });
      }
      return Response.json({ results: [{ title: 'Tavily', url: 'https://example.com/t', content: 'An open source database.' }] });
    };
    try {
      const env = { EXA_DAILY_CAP: 'off', EXA_API_KEY: 'e', LANGSEARCH_API_KEY: 'l', TAVILY_API_KEY: 't', SEARCH_ORDER: 'exa,langsearch,tavily', ENGINE_SKIP: store.kv } as Env;
      const skips = await loadSkips(env);
      assert.equal(skips.exa, until);
      assert.equal(skips.tavily, undefined);
      await loadSkips(env);
      assert.equal(store.gets(), 1);
      const ledger = newLedger();
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env, ledger);
      assert.equal(out.engine, 'langsearch');
      assert.equal(seen.some((url) => url.includes('api.exa.ai')), false);
      assert.ok(ledger.fellThrough.includes('exa:skipped'));
      assert.equal(ledger.search.exa, 0);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });
});
