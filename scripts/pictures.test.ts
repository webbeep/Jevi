import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ImageResult } from '../shared/types.ts';
import { PictureResolver } from '../server/pictures.ts';
import type { Env } from '../server/util.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('fact tiles drop attached pictures', () => {
  const pool: ImageResult[] = [
    { url: 'https://www.flickr.com/photos/100mile', thumb: 'https://live.staticflickr.com/100mile.jpg', title: '100 mile challenge', source: 'flickr', license: 'source' },
    { url: 'https://en.wikipedia.org/wiki/Network_theory', thumb: 'https://upload.wikimedia.org/network.png', title: 'Vox Media network', source: 'wikipedia', license: 'source' },
  ];
  const grid: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Host', value: 'Marques Brownlee', sub: 'MKBHD', icon: 'user', imageRef: 0, imageQuery: 'Marques Brownlee' },
      { type: 'tile', label: 'Co-hosts', value: 'Andrew Manganelli', sub: 'David Imel', icon: 'users', imageQuery: 'Andrew Manganelli' },
      { type: 'tile', label: 'New episodes', value: 'Weekly', sub: 'Fridays 4AM ET', imageRef: 0, imageSrc: 'https://live.staticflickr.com/100mile.jpg' },
      { type: 'tile', label: 'Network', value: 'Vox Media', sub: 'Podcast Network', imageRef: 1, imageQuery: 'Vox Media' },
    ],
  };
  let lookups = 0;
  const shown: CardNode[] = [];
  const resolver = new PictureResolver({} as Env, pool, () => undefined, 'Waveform MKBHD', async () => {
    lookups += 1;
    return [];
  });
  resolver.emit(grid, 0, (node) => shown.push(node));
  assert.equal(lookups, 0);
  const first = shown[0];
  assert.equal(first?.type, 'grid');
  if (first?.type !== 'grid') return;
  for (const child of first.children) {
    assert.equal(child.type, 'tile');
    if (child.type !== 'tile') continue;
    assert.equal(child.imageSrc, undefined);
    assert.equal(child.imageRef, undefined);
    assert.equal(child.imageQuery, undefined);
  }
});

test('product rows start looking up pictures when the row is shown', async () => {
  const credits: { src: string }[] = [];
  let lookups = 0;
  const find = async (query: string): Promise<ImageResult[]> => {
    lookups += 1;
    await delay(400);
    const src = `https://img.test/${encodeURIComponent(query)}.jpg`;
    return [{ url: `https://img.test/${encodeURIComponent(query)}`, thumb: src, title: query, source: 'img.test', license: 'open', credit: query }];
  };
  const list: CardNode = {
    type: 'list',
    style: 'media',
    items: [{ text: 'Brooks Ghost 18' }, { text: 'Nike Winflo 12' }, { text: 'Asics Novablast 6' }],
  };
  const shown: CardNode[] = [];
  const resolver = new PictureResolver({} as Env, [], (credit) => credits.push(credit), 'best running shoes for beginners', find, {
    results: [],
    cardImages: async () => [],
  });
  resolver.emit(list, 0, (node) => shown.push(node));
  await delay(30);
  assert.equal(lookups, 3);
  await delay(500);
  assert.equal(credits.length, 3);
  assert.equal(new Set(credits.map((c) => c.src)).size, 3);
  const started = Date.now();
  await resolver.flush(200);
  assert.ok(Date.now() - started < 180);
  const done = shown.at(-1);
  assert.equal(done?.type, 'list');
  if (done?.type === 'list') assert.equal(done.items.every((item) => !!item.imageSrc), true);
});

test('a product row still gets its pictures when the rest of the card finishes first', async () => {
  const credits: { src: string }[] = [];
  const find = async (query: string): Promise<ImageResult[]> => {
    await delay(600);
    const src = `https://img.test/${encodeURIComponent(query)}.jpg`;
    return [{ url: `https://img.test/${encodeURIComponent(query)}`, thumb: src, title: query, source: 'img.test', license: 'open', credit: query }];
  };
  const list: CardNode = {
    type: 'list',
    style: 'media',
    items: [{ text: 'Brooks Ghost 18' }, { text: 'Nike Winflo 12' }, { text: 'Asics Novablast 6' }],
  };
  const shown: CardNode[] = [];
  const resolver = new PictureResolver({} as Env, [], (credit) => credits.push(credit), 'best running shoes for beginners', find, {
    results: [],
    cardImages: async () => [],
  });
  resolver.emit(list, 0, (node) => shown.push(node));
  const started = Date.now();
  await resolver.flush(100);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 500 && elapsed < 2500);
  assert.equal(credits.length, 3);
  const done = shown.at(-1);
  assert.equal(done?.type, 'list');
  if (done?.type === 'list') assert.equal(done.items.every((item) => !!item.imageSrc), true);
});

test('a softmax caption drops a page preview and keeps a real heatmap', () => {
  const preview: ImageResult = {
    url: 'https://www.ibm.com/blog/attention',
    thumb: 'https://assets.ibm.com/is/image/ibm/attention-leadspace.jpg',
    title: 'Attention mechanism',
    source: 'ibm.com',
    license: 'source',
  };
  const heatmap: ImageResult = {
    url: 'https://en.wikipedia.org/wiki/Attention',
    thumb: 'https://upload.wikimedia.org/wikipedia/commons/attention-heatmap.png',
    title: 'Attention heatmap',
    source: 'wikipedia',
    license: 'open',
  };
  const caption = 'Each row is a token; brighter cells are the tokens it listens to most';
  const dropped: CardNode[] = [];
  new PictureResolver({} as Env, [preview], () => undefined, 'Explain how an LLM attention layer works')
    .emit({ type: 'image', ref: 0, caption, aspect: 'wide' }, 0, (node) => dropped.push(node));
  const gone = dropped[0];
  assert.equal(gone?.type, 'image');
  if (gone?.type !== 'image') return;
  assert.equal(gone.ref, undefined);
  assert.equal(gone.src, undefined);
  assert.equal(gone.query, undefined);
  assert.match(gone.caption ?? '', /brighter cells/);

  const kept: CardNode[] = [];
  new PictureResolver({} as Env, [heatmap], () => undefined, 'Explain how an LLM attention layer works')
    .emit({ type: 'image', ref: 0, caption, aspect: 'wide' }, 0, (node) => kept.push(node));
  const stay = kept[0];
  assert.equal(stay?.type, 'image');
  if (stay?.type !== 'image') return;
  assert.equal(stay.ref, 0);
});

test('a softmax picture query does not search for a stand-in photo', async () => {
  let lookups = 0;
  const shown: CardNode[] = [];
  const resolver = new PictureResolver({} as Env, [{
    url: 'https://www.ibm.com/blog/attention',
    thumb: 'https://assets.ibm.com/is/image/ibm/attention-leadspace.jpg',
    title: 'Attention mechanism',
    source: 'ibm.com',
    license: 'source',
  }], () => undefined, 'Explain how an LLM attention layer works', async () => {
    lookups += 1;
    return [];
  });
  resolver.emit({
    type: 'image',
    query: 'softmax attention heatmap',
    caption: 'Each row is a token; brighter cells are the tokens it listens to most',
  }, 0, (node) => shown.push(node));
  await resolver.flush();
  assert.equal(lookups, 0);
  const last = shown.at(-1);
  assert.equal(last?.type, 'image');
  if (last?.type !== 'image') return;
  assert.equal(last.src, undefined);
  assert.equal(last.query, undefined);
});
