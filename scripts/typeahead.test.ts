import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAiLines, suggestTypeahead } from '../server/typeahead.ts';
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

test('prefixes shorter than 3 characters yield no suggestions', async () => {
  assert.equal(normalizePrefix('  hi ').length, 2);
  assert.deepEqual(matchLocal(['best wireless earbuds under $100'], 'ab'), []);
  const result = await suggestTypeahead('ab', {});
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.source, 'none');
});

test('mergeSuggestions keeps history, then AI, then fallback, deduped and capped', () => {
  const merged = mergeSuggestions(
    ['Running shoes for rain', 'running shoes for rain', 'exact input'],
    ['running shoes for gym', 'Running shoes for rain'],
    ['how to get a red wine stain out of a carpet', 'running shoes for gym', 'one', 'two', 'three', 'four'],
    'exact input',
    5,
  );
  assert.deepEqual(merged.map((row) => row.source), ['history', 'ai', 'fallback', 'fallback', 'fallback']);
  assert.equal(merged[0].text, 'Running shoes for rain');
  assert.equal(merged[1].text, 'running shoes for gym');
  assert.equal(merged.length, 5);
  assert.equal(merged.some((row) => row.text.toLowerCase() === 'exact input'), false);
});

test('mergeSuggestions uses the fallback list when AI returns nothing', () => {
  const merged = mergeSuggestions([], [], ['best wireless earbuds under $100'], 'best w', 5);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'fallback');
  assert.equal(merged[0].text, 'best wireless earbuds under $100');
  assert.deepEqual(mergeSuggestions(['Best W'], [], ['Best W'], 'best w', 5), []);
});

test('matchLocal matches prefix, substring, and word, and drops the exact input', () => {
  const list = ['best wireless earbuds under $100', 'how to get a red wine stain out of a carpet', 'Best wireless earbuds under $100'];
  assert.deepEqual(matchLocal(list, 'best wireless'), ['best wireless earbuds under $100']);
  assert.equal(matchLocal(list, 'wine').some((text) => text.includes('wine')), true);
  assert.deepEqual(matchLocal(['best wireless earbuds under $100'], 'best wireless earbuds under $100'), []);
});

test('parseAiLines strips numbering, quotes, and bullets, and drops empties and the prefix', () => {
  const lines = parseAiLines([
    '1. best wireless earbuds under $50',
    '2) "best wireless earbuds for running"',
    '- best wireless earbuds for work',
    '* best wireless earbuds under $50',
    'best wireless',
    '',
    'cheap laptops under $500',
  ].join('\n'), 'best wireless');
  assert.deepEqual(lines, [
    'best wireless earbuds under $50',
    'best wireless earbuds for running',
    'best wireless earbuds for work',
  ]);
});

test('suggestTypeahead returns AI lines, then serves the isolate cache', async () => {
  let calls = 0;
  const env = {
    AI: {
      async run() {
        calls += 1;
        return { response: '1. quark earbuds alpha\n2. quark earbuds beta\n3. quark earbuds gamma\n' };
      },
    },
  } as Env;
  const first = await suggestTypeahead('quark earbuds', env);
  assert.equal(first.source, 'ai');
  assert.deepEqual(first.suggestions, ['quark earbuds alpha', 'quark earbuds beta', 'quark earbuds gamma']);
  const second = await suggestTypeahead('  Quark   earbuds ', env);
  assert.equal(second.source, 'cache');
  assert.equal(calls, 1);
});

test('suggestTypeahead returns none when AI is off, errors, or times out', async () => {
  const off = await suggestTypeahead('quark disabled zz', { TYPEAHEAD: 'off', AI: { async run() { throw new Error('should not run'); } } } as Env);
  assert.equal(off.source, 'none');
  assert.deepEqual(off.suggestions, []);

  const failed = await suggestTypeahead('quark explode zz', { AI: { async run() { throw new Error('nope'); } } } as Env);
  assert.equal(failed.source, 'none');

  const timed = await suggestTypeahead('quark timeout zz', { AI: { run: () => new Promise(() => {}) } } as Env);
  assert.equal(timed.source, 'none');
  assert.ok(timed.ms >= 700);
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
