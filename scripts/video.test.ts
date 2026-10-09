import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designParallel } from '../server/design.ts';
import type { Env } from '../server/util.ts';
import { parseYouTube, videoResults, wantsVideo, withVideos } from '../server/videoSearch.ts';
import type { CardNode } from '../shared/card.ts';
import type { SearchResult } from '../shared/types.ts';

const renderer = (id: string, title: string, owner = 'NBA', length = '4:43', ago = '16h ago') => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: owner }] },
    lengthText: { simpleText: length },
    publishedTimeText: { simpleText: ago },
  },
});

function page(items: unknown[]): string {
  const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

const web = (n: number): SearchResult[] => Array.from({ length: n }, (_, i) => ({
  title: `LeBron James 76ers preseason debut recap ${i + 1}`,
  url: `https://news${i}.example.com/lebron`,
  snippet: 'LeBron James scored 10 points in his 76ers preseason debut.',
  domain: `news${i}.example.com`,
  engines: ['serper'],
}));

test('watch asks are recognised', () => {
  assert.equal(wantsVideo('Watch the highlights'), true);
  assert.equal(wantsVideo('LeBron James 76ers preseason debut highlights vs Brooklyn Nets'), true);
  assert.equal(wantsVideo('iphone 17 review video'), true);
  assert.equal(wantsVideo('who is Ed chu'), false);
});

test('parseYouTube reads video rows from ytInitialData', () => {
  const rows = parseYouTube(page([
    renderer('wx00qoZX68Y', "HIGHLIGHTS from LeBron James' 76ers preseason debut", 'NBA on ESPN'),
    { shelfRenderer: { content: { verticalListRenderer: { items: [renderer('JT0scXXgskw', 'LeBron James DID IT ALL in his 76ers Preseason Debut', 'NBA', '1:12')] } } } },
    renderer('wx00qoZX68Y', 'duplicate'),
    renderer('bad', 'not an id'),
  ]));
  assert.deepEqual(rows.map((r) => r.url), ['https://www.youtube.com/watch?v=wx00qoZX68Y', 'https://www.youtube.com/watch?v=JT0scXXgskw']);
  assert.equal(rows[0]!.snippet, 'NBA on ESPN · 4:43 · 16h ago');
  assert.equal(rows[0]!.image, 'https://i.ytimg.com/vi/wx00qoZX68Y/hqdefault.jpg');
  assert.deepEqual(parseYouTube('<html>consent page</html>'), []);
});

test('videoResults keeps on-topic clips only and never throws', async () => {
  const html = page([
    renderer('wx00qoZX68Y', "HIGHLIGHTS from LeBron James' 76ers preseason debut vs Nets"),
    renderer('aaaaaaaaaaa', 'Best cat videos compilation 2026', 'Cats'),
    renderer('zHBgJqG1nJo', 'LeBron James preseason debut highlights | 76ers vs Nets'),
  ]);
  const ok = (async () => new Response(html)) as unknown as typeof fetch;
  const rows = await videoResults('LeBron James 76ers preseason debut highlights', ok);
  assert.deepEqual(rows.map((r) => r.url.slice(-11)), ['wx00qoZX68Y', 'zHBgJqG1nJo']);
  const down = (async () => new Response('no', { status: 429 })) as unknown as typeof fetch;
  assert.deepEqual(await videoResults('some other trailer ask', down), []);
  assert.deepEqual(await videoResults('who is Ed chu', ok), []);
});

test('the best clip leads the sources and the rest follow the first web results', () => {
  const clips = parseYouTube(page([renderer('wx00qoZX68Y', 'LeBron highlights A'), renderer('zHBgJqG1nJo', 'LeBron highlights B')]));
  const merged = withVideos(clips, [...web(5), { ...clips[1]!, engines: ['serper'] }]);
  assert.equal(merged[0]!.url, clips[0]!.url);
  assert.equal(merged[4]!.url, clips[1]!.url);
  assert.equal(merged.filter((r) => r.url === clips[1]!.url).length, 1);
  assert.equal(merged.length, 7);
});

test('a watch card opens on the playable source', async () => {
  const clip = parseYouTube(page([renderer('wx00qoZX68Y', 'LeBron highlights')]))[0]!;
  const nodes: { node: CardNode; index: number }[] = [];
  await designParallel({
    query: 'LeBron James 76ers preseason debut highlights',
    pattern: 'visual',
    depth: 'standard',
    search: { query: 'x', freshness: 'any', results: [...web(1), clip, ...web(2)], images: [], discussions: [], engines: [] },
    pages: [],
  }, {} as Env, { layout: () => undefined, head: () => undefined, node: (node, index) => nodes.push({ node, index }), followups: () => undefined, credit: () => undefined });
  assert.deepEqual(nodes[0], { node: { type: 'video', source: 2 }, index: 0 });
});
