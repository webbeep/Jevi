import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { matches } from '../shared/imagematch.ts';
import { test } from 'node:test';
import { fileWords, fitsEntity, isComposite, namesSibling, rankForEntity, splitEntities, type MatchImage } from '../shared/imagematch.ts';

const img = (title: string, thumb = 'https://cdn.example/photo.jpg'): MatchImage => ({ title, thumb });

test('isComposite spots comparison and collage pictures', () => {
  const yes: MatchImage[] = [
    img('iPhone 18 Pro vs Pixel 11 Pro: which flagship?'),
    img('review', 'https://cdn.example/iphone-18-pro-vs-pixel-11-pro.jpg'),
    img('Kindle Paperwhite versus Kobo'),
    img('Best phones compared'),
    img('comparison'),
    img('', 'https://cdn.example/AirPods_Pro_3_vs_Sony.webp'),
    img('side-by-side'),
    img('Kindle 2026 lineup: prices'),
  ];
  for (const picture of yes) assert.equal(isComposite(picture), true, picture.title || picture.thumb);
  const no: MatchImage[] = [
    img('iPhone 18 Pro review'),
    img('print', 'https://cdn.example/canvas-print.jpg'),
    img('Pixel 11 Pro hands-on'),
    img('VSCO'),
  ];
  for (const picture of no) assert.equal(isComposite(picture), false, picture.title || picture.thumb);
});

test('splitEntities pulls product names out of comparison questions', () => {
  assert.deepEqual(splitEntities('iPhone 17 vs Pixel 10'), ['iPhone 17', 'Pixel 10']);
  assert.deepEqual(
    splitEntities('AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra Earbuds, current prices'),
    ['AirPods Pro 3', 'Sony WF-1000XM5', 'Bose QuietComfort Ultra Earbuds'],
  );
  assert.deepEqual(splitEntities('iPad Air vs iPad Pro for drawing, which one and how much?'), ['iPad Air', 'iPad Pro']);
  assert.deepEqual(
    splitEntities('Kindle Paperwhite vs Kobo Clara BW for reading, which should I buy and what do they cost?'),
    ['Kindle Paperwhite', 'Kobo Clara BW'],
  );
  assert.deepEqual(splitEntities('best running shoes'), []);
});

test('fitsEntity keeps a picture only when it is that item', () => {
  const siblings = ['iPhone 18 Pro', 'Pixel 11 Pro'];
  assert.equal(fitsEntity('iPhone 18 Pro', img('iPhone 18 Pro vs Pixel 11 Pro', 'https://cdn.example/iphone-18-pro-vs-pixel-11-pro.jpg'), siblings), false);
  assert.equal(fitsEntity('iPhone 18 Pro', img('Pixel 11 Pro and iPhone 18 Pro hands-on', 'https://cdn.example/hands-on.jpg'), siblings), false);
  assert.equal(fitsEntity('iPhone 18 Pro', img('iPhone 18 Pro - Apple', 'https://cdn.example/iphone-18-pro.jpg'), siblings), true);
  assert.equal(
    fitsEntity(
      'Kobo Clara BW eReader',
      img('Amazon Kindle (2024) vs Kobo Clara BW: which wins?', 'https://img.frontdeskreview.com/products/kobo-clara-bw.jpg'),
      ['Kindle Paperwhite', 'Kobo Clara BW eReader'],
    ),
    true,
  );
  assert.equal(fitsEntity('Kindle Paperwhite', img('Kindle Paperwhite review', 'https://cdn.example/kindle-paperwhite.jpg'), ['Kindle']), true);
});

const FIXTURES = '/workspace/easy-cash/fleet-v2/org/eng/zo/quality/fixtures/scenarios';

test('model numbers match with or without hyphens', () => {
  assert.equal(matches('Sony WF-1000XM5', 'Sony WF-1000XM5 review'), true);
  assert.equal(matches('Sony WF1000XM5', 'Sony WF-1000XM5 review'), true);
  assert.equal(matches('Sony WF-1000XM5', 'Sony WF-1000XM4 review'), false);
});

/** Image pools recorded from live comparison answers (p06 Kindle vs Kobo, p07 earbuds), checked in so this always runs. */
const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/comparison-images.json', import.meta.url), 'utf8')) as Record<string, { query: string; images: MatchImage[] }>;

test('recorded comparison pools: every entity gets its own picture or none', () => {
  const picks: Record<string, string> = {};
  for (const [id, entities] of [['p06-d-r1', ['Kindle Paperwhite 2024 eReader', 'Kobo Clara BW eReader']], ['p07-d-r1', ['AirPods Pro 3', 'Sony WF-1000XM5', 'Bose QuietComfort Ultra Earbuds']]] as const) {
    const { query, images } = RECORDED[id];
    const siblings = splitEntities(query);
    // Before the fix the Kobo tile took this page's "kindle-paperwhite-vs-kobo-clara" composite.
    assert.ok(images.some((i) => isComposite(i) && /kobo|airpods/i.test(i.title ?? '')), `${id} has composites to reject`);
    const used = new Set<string>();
    for (const entity of entities) {
      const pick = rankForEntity(entity, images, siblings, used);
      picks[entity] = pick?.thumb ?? 'none';
      if (!pick) continue;
      used.add(pick.thumb);
      assert.equal(isComposite(pick), false, `${entity} → ${pick.title}`);
      assert.equal(namesSibling(entity, pick.title ?? '', siblings) && namesSibling(entity, fileWords(pick.thumb), siblings), false, pick.thumb);
    }
  }
  assert.match(picks['Kobo Clara BW eReader'], /kobo-clara-bw/);
});

function replay(file: string, entities: string[]): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { query: string; search: { images: MatchImage[] } };
  const siblings = splitEntities(data.query);
  const pool = data.search.images;
  for (const entity of entities) {
    const pick = rankForEntity(entity, pool, siblings, new Set());
    console.log(entity, pick?.thumb ?? 'none');
    if (!pick) continue;
    assert.equal(isComposite(pick), false, `${entity} → ${pick.title}`);
    assert.equal(namesSibling(entity, pick.title ?? '', siblings), false, pick.title);
    assert.equal(namesSibling(entity, fileWords(pick.thumb), siblings), false, pick.thumb);
  }
}

test('replay p06 kindle and kobo pictures are not comparisons', (t) => {
  const file = `${FIXTURES}/p06-d-r1.json`;
  if (!existsSync(file)) return t.skip();
  replay(file, ['Kindle Paperwhite 2024 eReader', 'Kobo Clara BW eReader']);
});

test('replay p07 earbud pictures are not comparisons', (t) => {
  const file = `${FIXTURES}/p07-d-r1.json`;
  if (!existsSync(file)) return t.skip();
  replay(file, ['AirPods Pro 3', 'Sony WF-1000XM5', 'Bose QuietComfort Ultra Earbuds']);
});

test('replay p08 when a fixture is present', (t) => {
  if (!existsSync(FIXTURES)) return t.skip();
  const file = readdirSync(FIXTURES).find((name) => name.startsWith('p08'));
  if (!file) return t.skip();
  const data = JSON.parse(readFileSync(`${FIXTURES}/${file}`, 'utf8')) as { query: string };
  replay(`${FIXTURES}/${file}`, splitEntities(data.query));
});
