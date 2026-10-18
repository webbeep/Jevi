import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchResponse, SearchResult } from '../shared/types.ts';
import { newLedger, type AskScope } from '../server/budget.ts';
import { resetDeepseekSlots, takeDeepseekSlot } from '../server/deepseekTools.ts';
import {
  applyFetched,
  factKind,
  fetchCitePages,
  fillFromSearch,
  focusFact,
  gapSearchQuery,
  namedSite,
  shiftBrief,
  snippetSupports,
  thinPlan,
} from '../server/thinSource.ts';

function row(partial: Partial<SearchResult> & { url: string; title: string }): SearchResult {
  return {
    snippet: '',
    domain: new URL(partial.url).hostname,
    engines: ['web'],
    ...partial,
  };
}

function response(results: SearchResult[], images: SearchResponse['images'] = []): SearchResponse {
  return { query: 'q', freshness: 'any', results, images, discussions: [], engines: [] };
}

function scope(): AskScope {
  return { ledger: newLedger(), bypass: false };
}

test('a fee, a tax rate, a spec, and a quote are the facts a thin snippet can miss', () => {
  assert.equal(factKind('US passport book renewal fee'), 'levy');
  assert.equal(factKind('what is the sales tax rate in Austin'), 'levy');
  assert.equal(factKind('iPhone 16 battery capacity'), 'spec');
  assert.equal(factKind('quote the first line of the Gettysburg Address'), 'quote');
  assert.equal(factKind('Fitbit Edge vs Mi Band 10'), undefined);
  assert.equal(factKind('Compare Fitbit Edge vs Mi Band 10'), undefined);
});

test('the official page is fetched when its snippet has no amount, and skipped when the amount is already there', () => {
  const thin = row({
    title: 'Passport fees',
    url: 'https://travel.state.gov/content/travel/en/passports/passport-help/fees.html',
    domain: 'travel.state.gov',
    snippet: 'Find the current fees for a passport book and a passport card.',
  });
  const priced = { ...thin, snippet: 'A passport book renewal for an adult is $130.' };
  const blog = row({
    title: 'Passport fee guide',
    url: 'https://example.com/passport-fees',
    domain: 'example.com',
    snippet: 'We explain passport fees.',
  });
  const plan = thinPlan('US passport book renewal fee', [blog, thin]);
  assert.deepEqual(plan.fetches, [thin.url]);
  assert.equal(plan.search, false);
  assert.equal(thinPlan('US passport book renewal fee', [priced]).fetches.length, 0);
  assert.equal(thinPlan('US passport book renewal fee', [priced]).search, false);
  assert.equal(snippetSupports('levy', priced.snippet), true);
});

test('a product spec page is read when the snippet has no measurement, not when the measurement is already in a snippet', () => {
  const official = row({
    title: 'iPhone 16 - Technical Specifications',
    url: 'https://www.apple.com/iphone-16/specs/',
    domain: 'apple.com',
    snippet: 'The most advanced iPhone ever, with a new design.',
  });
  const measured = row({
    title: 'iPhone 16 review',
    url: 'https://www.theverge.com/iphone-16-review',
    domain: 'theverge.com',
    snippet: 'Battery life is rated at 22 hours of video playback.',
  });
  const roundup = row({
    title: 'Best iPhone 16 battery comparisons',
    url: 'https://www.tomsguide.com/best-iphone-16',
    domain: 'tomsguide.com',
    snippet: 'We tested the latest phones.',
  });
  assert.deepEqual(thinPlan('iPhone 16 battery capacity', [roundup, official]).fetches, [official.url]);
  const covered = thinPlan('iPhone 16 battery capacity', [measured, official]);
  assert.deepEqual(covered.fetches, []);
  assert.equal(covered.search, false);
  assert.equal(thinPlan('iPhone 16 battery capacity', [measured]).search, false);
});

test('a comparison does not search once per product, and a missing fee is one search', () => {
  const blogs = [
    row({ title: 'Passport tips', url: 'https://example.com/a', snippet: 'Renew early.' }),
    row({ title: 'Travel checklist', url: 'https://example.com/b', snippet: 'Bring a photo.' }),
  ];
  const plan = thinPlan('US passport book renewal fee', blogs);
  assert.deepEqual(plan.fetches, []);
  assert.equal(plan.search, true);
  assert.equal(plan.site, undefined);
  const vs = thinPlan('Fitbit Edge vs Mi Band 10', [
    row({ title: 'Fitbit Edge', url: 'https://www.fitbit.com/global/us/products/trackers/edge', snippet: 'Up to 14 days of battery and a $199 price.' }),
    row({ title: 'Mi Band 10', url: 'https://www.mi.com/global/product/mi-band-10', snippet: '1.74-inch display. Battery lasts 18 days. $49.' }),
  ]);
  assert.equal(vs.search, false);
  assert.equal(vs.fetches.length, 0);
  const query = gapSearchQuery('US passport book renewal fee', plan.site);
  assert.equal(query.includes('site:'), false);
  assert.equal(gapSearchQuery('Fitbit Edge vs Mi Band 10').split('vs').length, 2);
});

test('site: is added only when a site is already written', () => {
  assert.equal(namedSite('passport fee', [{ title: 'Fees', snippet: 'See the schedule.' }]), undefined);
  assert.equal(namedSite('passport fee site:travel.state.gov', []), 'travel.state.gov');
  assert.equal(namedSite('fee listed at travel.state.gov', []), 'travel.state.gov');
  assert.equal(
    namedSite('passport fee', [{ title: 'Fees', snippet: 'Published on travel.state.gov for travelers.' }]),
    'travel.state.gov',
  );
  const query = gapSearchQuery('what is the passport renewal fee', 'travel.state.gov');
  assert.match(query, /site:travel\.state\.gov$/);
  assert.equal(query.length <= 128, true);
  assert.equal((query.match(/site:/g) ?? []).length, 1);
});

test('a failed fetch or search leaves the Serper rows and images in place', async () => {
  resetDeepseekSlots();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  try {
    const photo = { url: 'https://example.com/p', thumb: 'https://example.com/p.jpg', title: 'Passport', source: 'example.com', license: 'source' as const, credit: 'example.com' };
    const gov = row({
      title: 'Passport fees',
      url: 'https://travel.state.gov/fees',
      domain: 'travel.state.gov',
      snippet: 'Current passport fees.',
    });
    const search = response([gov], [photo]);
    const pages = await fetchCitePages({ DEEPSEEK_API_KEY: 'test' }, scope(), 'levy', [gov.url], 400);
    assert.deepEqual(pages, []);
    const applied = applyFetched(search, [], pages);
    assert.equal(applied.search.results[0]?.snippet, gov.snippet);
    assert.equal(applied.search.images.length, 1);
    const blogs = response([
      row({ title: 'Tips', url: 'https://example.com/a', snippet: 'Renew early.' }),
    ], [photo]);
    const filled = await fillFromSearch('US passport book renewal fee', blogs, { DEEPSEEK_API_KEY: 'test' }, scope(), 'levy', undefined, 400);
    assert.equal(filled, undefined);
    assert.equal(blogs.results.length, 1);
    assert.equal(blogs.images[0]?.thumb, photo.thumb);
  } finally {
    globalThis.fetch = original;
    resetDeepseekSlots();
  }
});

test('a fetch is cached per url, and a gap search asks for page content instead of fetching again', async () => {
  resetDeepseekSlots();
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  let fetches = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { url?: string; need_content?: boolean };
    bodies.push({ url, body });
    if (url.endsWith('/fetch')) {
      fetches += 1;
      return Response.json({ title: 'Fees', content: 'An adult passport book renewal is $130.\n\nPay when you apply.' });
    }
    return Response.json({
      results: [{
        title: 'Passport fees',
        url: 'https://travel.state.gov/fees',
        snippet: 'Fee schedule.',
        summary: 'The page lists passport fees.',
        content: 'An adult passport book renewal is $130.\n\nPay when you apply.',
      }],
    });
  };
  try {
    const ask = scope();
    const gov = row({ title: 'Passport fees', url: 'https://travel.state.gov/fees', domain: 'travel.state.gov', snippet: 'Fee schedule.' });
    const first = await fetchCitePages({ DEEPSEEK_API_KEY: 'test' }, ask, 'levy', [gov.url, gov.url], 2000);
    const second = await fetchCitePages({ DEEPSEEK_API_KEY: 'test' }, ask, 'levy', [gov.url], 2000);
    assert.equal(fetches, 1);
    assert.match(first[0]?.text ?? '', /\$130/);
    assert.equal(second[0]?.text, first[0]?.text);
    const focused = focusFact('levy', 'Navigation\n\nAn adult passport book renewal is $130.\n\nMore links');
    assert.match(focused, /\$130/);
    const blogs = response([row({ title: 'Tips', url: 'https://example.com/a', snippet: 'Renew early.' })]);
    const filled = await fillFromSearch('US passport renewal fee', blogs, { DEEPSEEK_API_KEY: 'test' }, scope(), 'levy', 'travel.state.gov', 2000);
    assert.equal(filled?.added, true);
    assert.equal(filled?.search.results[0]?.url, 'https://travel.state.gov/fees');
    assert.equal(filled?.search.results[1]?.url, 'https://example.com/a');
    assert.match(filled?.search.results[0]?.content ?? '', /\$130/);
    assert.equal(blogs.images.length, 0);
    const searchCall = bodies.find((item) => (item as { url: string }).url.endsWith('/search')) as { body: { need_content?: boolean; ori_question?: string; query?: string } };
    assert.equal(searchCall.body.need_content, true);
    assert.equal(bodies.filter((item) => (item as { url: string }).url.endsWith('/fetch')).length, 1);
    assert.match(searchCall.body.ori_question ?? '', /passport renewal fee/);
    assert.match(searchCall.body.query ?? '', /site:travel\.state\.gov/);
  } finally {
    globalThis.fetch = original;
    resetDeepseekSlots();
  }
});

test('source numbers move when a gap row is inserted, and a quote lead stays first', () => {
  const brief = shiftBrief({ goal: 'fee', use: [1, 2], stale: [], offTopic: [3], conflicts: ['[2] says 130'], missing: 'the fee' }, 0, 1);
  assert.deepEqual(brief.use, [2, 3]);
  assert.deepEqual(brief.offTopic, [4]);
  assert.equal(brief.conflicts[0], '[3] says 130');
  const kept = shiftBrief({ goal: 'price', use: [1], stale: [2], offTopic: [], conflicts: [] }, 1, 1);
  assert.deepEqual(kept.use, [1]);
  assert.deepEqual(kept.stale, [3]);
});

test('the local window fails open instead of queueing a sixth call', () => {
  resetDeepseekSlots();
  const now = 10_000;
  for (let i = 0; i < 5; i++) assert.equal(takeDeepseekSlot('fetch', now), true);
  assert.equal(takeDeepseekSlot('fetch', now + 10), false);
  assert.equal(takeDeepseekSlot('search', now), true);
  assert.equal(takeDeepseekSlot('fetch', now + 1000), true);
  resetDeepseekSlots();
});
