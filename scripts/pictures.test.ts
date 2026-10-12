import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ImageResult } from '../shared/types.ts';
import { PictureResolver } from '../server/pictures.ts';
import type { Env } from '../server/util.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pic = (title: string, thumb: string, url = 'https://example.com/page'): ImageResult => ({
  url,
  thumb,
  title,
  source: 'example.com',
  license: 'source',
});

test('a person gallery keeps a full-name photo and drops surname-only pictures', () => {
  const pool = [
    pic('Leonard Miller', 'https://cdn.nba.com/headshots/nba/latest/1040x760/1642363.png', 'https://www.nba.com/player/leonard-miller'),
    pic('The Miller House', 'https://example.com/tudor-house.jpg'),
    pic('Miller bus company', 'https://example.com/double-decker-bus.jpg'),
    pic('Leonard Tennis Club', 'https://example.com/varsity-tennis.jpg'),
    pic('Leonard Miller', 'https://example.com/soldiers-group.jpg', 'https://news.example.com/leonard-miller'),
  ];
  const shown: CardNode[] = [];
  const resolver = new PictureResolver({} as Env, pool, () => undefined, 'Leonard Miller');
  resolver.emit({ type: 'gallery', refs: [0, 1, 2, 3, 4] }, 0, (node) => shown.push(node));
  const node = shown[0];
  assert.equal(node?.type, 'gallery');
  if (node?.type === 'gallery') assert.deepEqual(node.refs, [0]);
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
