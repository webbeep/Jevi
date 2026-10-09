import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSuggest, resetTypeaheadCache, suggestTypeahead } from '../server/typeahead.ts';
import type { Env } from '../server/util.ts';
import {
  createDebouncer,
  matchLocal,
  mergeSuggestions,
  normalizePrefix,
} from '../shared/typeahead.ts';

test('normalizePrefix trims, lowercases, collapses spaces, and clips to 80', () => {
  assert.equal(normalizePrefix('  Best   Wireless\tEarbuds  '), 'best wireless earbuds');
  assert.equal(normalizePrefix(` ${'A'.repeat(90)} `).length, 80);
  assert.equal(normalizePrefix('  ab '), 'ab');
});

test('prefixes shorter than 2 characters yield no suggestions', async () => {
  assert.deepEqual(matchLocal(['best wireless earbuds under $100'], 'b'), []);
  const result = await suggestTypeahead('a', {}, (() => { throw new Error('no fetch'); }) as typeof fetch);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.source, 'none');
});

test('mergeSuggestions keeps a few history rows, then web, then fallback, deduped and capped', () => {
  const merged = mergeSuggestions(
    ['Running shoes for rain', 'running shoes for rain', 'exact input', 'running shoes wide', 'running shoes flat', 'running shoes kids'],
    ['running shoes for gym', 'Running shoes for rain', 'running shoes nike'],
    ['how to get a red wine stain out of a carpet', 'one', 'two'],
    'exact input',
    6,
  );
  assert.deepEqual(merged.map((row) => row.source), ['history', 'history', 'history', 'web', 'web', 'fallback']);
  assert.equal(merged[0].text, 'Running shoes for rain');
  assert.equal(merged[3].text, 'running shoes for gym');
  assert.equal(merged.some((row) => row.text.toLowerCase() === 'exact input'), false);
});

test('mergeSuggestions shows only history and fallback when the web returns nothing', () => {
  const merged = mergeSuggestions(['best wok', 'best wool socks', 'best w1', 'best w2'], [], ['best wireless earbuds under $100'], 'best w', 6);
  assert.deepEqual(merged.map((row) => row.source), ['history', 'history', 'history', 'history', 'fallback']);
  assert.deepEqual(mergeSuggestions(['Best W'], [], ['Best W'], 'best w', 5), []);
});

test('matchLocal ranks prefix, then word-start, then substring matches, and drops the exact input', () => {
  const list = ['how to get a red wine stain out of a carpet', 'wine pairing for salmon', 'best wireless earbuds under $100', 'Best wireless earbuds under $100', 'twine knots'];
  assert.deepEqual(matchLocal(list, 'best wireless'), ['best wireless earbuds under $100']);
  assert.deepEqual(matchLocal(list, 'wine'), ['wine pairing for salmon', 'how to get a red wine stain out of a carpet', 'twine knots']);
  assert.deepEqual(matchLocal(list, 'red wine'), ['how to get a red wine stain out of a carpet']);
  assert.deepEqual(matchLocal(['twine knots'], 'wi'), [], 'two characters match word starts only');
  assert.deepEqual(matchLocal(['best wireless earbuds under $100'], 'best wireless earbuds under $100'), []);
});

test('parseSuggest reads the OpenSearch shape, dedupes, and drops the prefix', () => {
  assert.deepEqual(
    parseSuggest(['jaylen b', ['jaylen brown', 'Jaylen Brown', 'jaylen b', 'jaylen brown injury', '', 42, 'x'.repeat(90)]], 'Jaylen B'),
    ['jaylen brown', 'jaylen brown injury'],
  );
  assert.deepEqual(parseSuggest(['q', [{ phrase: 'q stock' }]], 'q'), ['q stock']);
  assert.deepEqual(parseSuggest({ nope: true }, 'q'), []);
});

function suggestFetch(handler: (url: string) => Response): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fetch: fn, urls };
}

const ok = (q: string, list: string[]) => new Response(JSON.stringify([q, list]), { status: 200 });

test('suggestTypeahead returns web completions without any model call, then serves the isolate cache', async () => {
  resetTypeaheadCache();
  let aiCalls = 0;
  const env = { AI: { async run() { aiCalls += 1; return { response: 'x' }; } } } as unknown as Env;
  const net = suggestFetch((url) => ok('quark earbuds', url.includes('google') ? ['quark earbuds alpha', 'quark earbuds beta'] : ['ddg']));
  const first = await suggestTypeahead('quark earbuds', env, net.fetch);
  assert.equal(first.source, 'web');
  assert.deepEqual(first.suggestions, ['quark earbuds alpha', 'quark earbuds beta']);
  const second = await suggestTypeahead('  Quark   earbuds ', env, net.fetch);
  assert.equal(second.source, 'cache');
  assert.equal(net.urls.length, 1);
  assert.equal(aiCalls, 0);
});

test('suggestTypeahead falls over to DuckDuckGo when Google fails', async () => {
  resetTypeaheadCache();
  const net = suggestFetch((url) => (url.includes('google') ? new Response('nope', { status: 503 }) : ok('rdw', ['rdw stock', 'rdw stock news'])));
  const out = await suggestTypeahead('rdw', {}, net.fetch);
  assert.equal(out.source, 'web');
  assert.deepEqual(out.suggestions, ['rdw stock', 'rdw stock news']);
  assert.ok(net.urls.some((u) => u.includes('duckduckgo')));
});

test('suggestTypeahead returns none when off or when every provider fails', async () => {
  resetTypeaheadCache();
  const net = suggestFetch(() => { throw new Error('should not run'); });
  const off = await suggestTypeahead('quark disabled zz', { TYPEAHEAD: 'off' }, net.fetch);
  assert.equal(off.source, 'none');
  assert.deepEqual(off.suggestions, []);
  assert.equal(net.urls.length, 0);

  const down = suggestFetch(() => new Response('[]', { status: 200 }));
  const failed = await suggestTypeahead('quark nothing zz', {}, down.fetch);
  assert.equal(failed.source, 'none');
  assert.match(failed.reason ?? '', /empty/);
});

test('createDebouncer runs only the last call after the delay, and cancel drops it', async () => {
  const calls: number[] = [];
  const debounced = createDebouncer((n: number) => calls.push(n), 40);
  debounced(1);
  debounced(2);
  debounced(3);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, []);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(calls, [3]);

  debounced(4);
  debounced.cancel();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(calls, [3]);
});
