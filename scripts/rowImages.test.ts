import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ImageResult, SearchResult } from '../shared/types.ts';
import { fillRowImages, rowEntity } from '../server/rowImages.ts';

const res = (url: string, image?: string): SearchResult => ({ title: url, url, snippet: '', domain: new URL(url).hostname, engines: ['serper'], image });
const pic = (title: string, thumb: string): ImageResult => ({ url: 'https://p.com/' + title, thumb, title, source: 'p.com', license: 'source' });

describe('T442 row and tile pictures', () => {
  test('rowEntity keeps the subject before dashes and commas', () => {
    assert.equal(rowEntity('Darryn Peterson — No. 2 pick, Jazz [3]'), 'Darryn Peterson');
    assert.equal(rowEntity('**Josh Dix**, OKC Thunder'), 'Josh Dix');
  });

  test('own source picture first, then one card search matched by name, then og:image of an unshared source', async () => {
    const results = [res('https://a.com/1', 'https://a.com/peterson.jpg'), res('https://b.com/2'), res('https://c.com/3'), res('https://d.com/rank')];
    const list: CardNode = {
      type: 'list',
      style: 'media',
      items: [
        { text: 'Darryn Peterson — Jazz', source: 1 },
        { text: 'Aday Mara — Thunder', source: 4 },
        { text: 'Cameron Boozer — Grizzlies', source: 4 },
        { text: 'Caleb Wilson — Bulls', source: 3 },
      ],
    };
    const tiles: CardNode = { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Lendeborg', value: 'Warriors' }, { type: 'tile', label: 'Games tonight', value: '4' }] };
    let calls = 0;
    const ogCalls: string[] = [];
    const out = await fillRowImages([list, tiles], {
      results,
      pool: [],
      cardImages: async () => {
        calls += 1;
        return [pic('Aday Mara Thunder rookie', 'https://img.com/mara.jpg'), pic('Yaxel Lendeborg Warriors', 'https://img.com/lendeborg.jpg'), pic('Boozer', 'http://img.com/boozer.jpg')];
      },
      og: async (url) => {
        ogCalls.push(url);
        return url.includes('c.com') ? 'https://c.com/og.jpg' : undefined;
      },
    });
    assert.equal(calls, 1);
    assert.equal(out.imageCalls, 1);
    const items = (out.nodes[0] as Extract<CardNode, { type: 'list' }>).items;
    assert.equal(items[0].imageSrc, 'https://a.com/peterson.jpg');
    assert.equal(items[1].imageSrc, 'https://img.com/mara.jpg');
    assert.equal(items[2].imageSrc, undefined, 'http picture never used; shared source gets no og:image');
    assert.equal(items[3].imageSrc, 'https://c.com/og.jpg');
    assert.deepEqual(ogCalls, ['https://c.com/3']);
    const t = (out.nodes[1] as Extract<CardNode, { type: 'grid' }>).children as Extract<CardNode, { type: 'tile' }>[];
    assert.equal(t[0].imageSrc, 'https://img.com/lendeborg.jpg');
    assert.equal(t[1].imageSrc, undefined);
  });

  test('nothing blank: no calls', async () => {
    let calls = 0;
    const node: CardNode = { type: 'list', style: 'number', items: [{ text: 'One' }] };
    const out = await fillRowImages([node], { results: [], pool: [], cardImages: async () => { calls += 1; return []; } });
    assert.equal(calls, 0);
    assert.equal(out.changed[0], false);
  });
});

describe('T442 stat tiles', () => {
  test('a name-like stat label gets a matching picture in `image`; generic labels are left alone', async () => {
    const nodes: CardNode[] = [
      { type: 'stat', label: 'Steph', value: '10 pts' },
      { type: 'stat', label: 'Points per game', value: '21' },
    ];
    const out = await fillRowImages(nodes, { results: [], pool: [], cardImages: async () => [pic('Steph Curry Warriors preseason', 'https://img.com/steph.jpg')] });
    assert.equal((out.nodes[0] as Extract<CardNode, { type: 'stat' }>).image, 'https://img.com/steph.jpg');
    assert.equal((out.nodes[1] as Extract<CardNode, { type: 'stat' }>).image, undefined);
  });
});
