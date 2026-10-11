import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTrending, resetTrendingCache, trendCountry } from '../server/trending.ts';
import { parseTrendsRss, titleQuery, TRENDING_LIMIT } from '../shared/trending.ts';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <title>Daily Search Trends</title>
  <item><title>amon ra st brown</title><ht:approx_traffic>2000+</ht:approx_traffic></item>
  <item><title>gibbs</title><ht:approx_traffic>500+</ht:approx_traffic></item>
  <item><title>jahmyr gibbs</title><ht:approx_traffic>5000+</ht:approx_traffic></item>
  <item><title><![CDATA[tulsa king season 4]]></title></item>
  <item><title>costco &amp; sam's</title></item>
  <item><title>how to get a red wine stain out</title></item>
  <item><title>one</title></item>
  <item><title>two</title></item>
  <item><title>three</title></item>
  <item><title>four extra</title></item>
</channel></rss>`;

test('titleQuery capitalizes a search and keeps small words lower', () => {
  assert.equal(titleQuery('amon ra st brown'), 'Amon Ra St Brown');
  assert.equal(titleQuery('  how to get a red wine stain  '), 'How to Get a Red Wine Stain');
  assert.equal(titleQuery('air fryer vs instant pot'), 'Air Fryer vs Instant Pot');
  assert.equal(titleQuery('mike mcdaniel'), 'Mike McDaniel');
});

test('parseTrendsRss drops a shorter duplicate, decodes titles, and stops at six', () => {
  const items = parseTrendsRss(FEED);
  assert.equal(items.length, TRENDING_LIMIT);
  assert.deepEqual(items.map((item) => item.query), [
    'Amon Ra St Brown',
    'Jahmyr Gibbs',
    'Tulsa King Season 4',
    "Costco & Sam's",
    'How to Get a Red Wine Stain Out',
    'One',
  ]);
  assert.equal(items.some((item) => item.query === 'Gibbs'), false);
  assert.equal(items.some((item) => item.query === 'Four Extra'), false);
});

test('trendCountry uses a real country code and falls back to US', () => {
  assert.equal(trendCountry(new Request('https://zo.fyi/', { headers: { 'cf-ipcountry': 'gb' } })), 'GB');
  assert.equal(trendCountry(new Request('https://zo.fyi/', { headers: { 'cf-ipcountry': 'XX' } })), 'US');
  assert.equal(trendCountry(new Request('https://zo.fyi/')), 'US');
});

test('loadTrending reads the country feed and falls back to the US list', async () => {
  resetTrendingCache();
  const calls: string[] = [];
  const fake: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const geo = new URL(url).searchParams.get('geo');
    const xml = geo === 'US' ? FEED : '<rss><channel></channel></rss>';
    return new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
  };
  const items = await loadTrending('FR', fake);
  assert.equal(items[0]?.query, 'Amon Ra St Brown');
  assert.deepEqual(calls.map((url) => new URL(url).searchParams.get('geo')), ['FR', 'US']);
  calls.length = 0;
  const again = await loadTrending('US', fake);
  assert.equal(again.length, TRENDING_LIMIT);
  assert.equal(calls.length, 0);
});

test('loadTrending returns nothing when the feed fails and nothing is cached', async () => {
  resetTrendingCache();
  const items = await loadTrending('US', async () => new Response('nope', { status: 503 }));
  assert.deepEqual(items, []);
});
