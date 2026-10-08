import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ImageResult, SearchResult } from '../shared/types.ts';
import { fillRowImages, rowEntity } from '../server/rowImages.ts';

const res = (url: string, image?: string, title = url): SearchResult => ({ title, url, snippet: '', domain: new URL(url).hostname, engines: ['serper'], image });
const pic = (title: string, thumb: string): ImageResult => ({ url: 'https://p.com/' + title, thumb, title, source: 'p.com', license: 'source' });

describe('T442 row and tile pictures', () => {
  test('rowEntity keeps the subject before dashes and commas', () => {
    assert.equal(rowEntity('Darryn Peterson — No. 2 pick, Jazz [3]'), 'Darryn Peterson');
    assert.equal(rowEntity('**Josh Dix**, OKC Thunder'), 'Josh Dix');
  });

  test('own source picture first, then one card search matched by name, then og:image of an unshared source', async () => {
    const results = [res('https://a.com/1', 'https://a.com/peterson.jpg', 'Darryn Peterson shines for Jazz'), res('https://b.com/2'), res('https://c.com/3', undefined, 'Caleb Wilson Bulls debut'), res('https://d.com/rank'), res('https://e.com/5', undefined, 'Yaxel Lendeborg leads Warriors rookies; 4 games tonight')];
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
    const out = await fillRowImages(nodes, { results: [res('https://n.com/1', undefined, 'Steph Curry scores 10 points in preseason')], pool: [], cardImages: async () => [pic('Steph Curry Warriors preseason', 'https://img.com/steph.jpg')] });
    assert.equal((out.nodes[0] as Extract<CardNode, { type: 'stat' }>).image, 'https://img.com/steph.jpg');
    assert.equal((out.nodes[1] as Extract<CardNode, { type: 'stat' }>).image, undefined);
  });

  test('t444: every filled picture reports its source page as a credit (card search and og:image)', async () => {
    const credits: { src: string; link: string }[] = [];
    const nodes: CardNode[] = [
      { type: 'stat', label: 'Steph', value: '10 pts' },
      { type: 'list', style: 'media', items: [{ text: 'Caleb Wilson — Bulls', source: 2 }] },
    ];
    await fillRowImages(nodes, {
      results: [res('https://n.com/1', undefined, 'Steph Curry scores 10 points in preseason'), res('https://c.com/3', undefined, 'Caleb Wilson Bulls debut')],
      pool: [],
      cardImages: async () => [pic('Steph Curry Warriors preseason', 'https://img.com/steph.jpg')],
      og: async () => 'https://c.com/wilson.jpg',
      onCredit: (c) => credits.push({ src: c.src, link: c.link }),
    });
    assert.deepEqual(credits, [
      { src: 'https://img.com/steph.jpg', link: 'https://p.com/Steph Curry Warriors preseason' },
      { src: 'https://c.com/wilson.jpg', link: 'https://c.com/3' },
    ]);
  });
});

import { accepts, targetFor } from '../server/imageGate.ts';

describe('T443 image relevance gate', () => {
  const img = (title: string, url = 'https://x.com/p', thumb = 'https://x.com/p.jpg') => ({ title, url, thumb });
  test('attribute tiles never get a photo', () => {
    assert.equal(targetFor('Role', 'Senior Software Engineer').kind, 'none');
    assert.equal(targetFor('Location', 'New York, NY').kind, 'none');
    assert.equal(accepts(targetFor('Role', 'Senior Software Engineer'), img('Senior software engineer playing guitar')), false);
  });
  test('org tiles need the org\'s own site', () => {
    const t = targetFor('Education', 'The Cooper Union');
    assert.deepEqual(t, { kind: 'org', entity: 'The Cooper Union' });
    assert.equal(accepts(t, img('Classroom with students', 'https://openverse.org/x', 'https://live.staticflickr.com/1.jpg')), false);
    assert.equal(accepts(t, img('', 'https://cooper.edu/', 'https://cooper.edu/og.jpg')), true);
    assert.equal(accepts(targetFor('Company', 'BlueFlame AI'), img('Office building', 'https://commons.wikimedia.org/x', 'https://upload.wikimedia.org/b.jpg')), false);
    assert.equal(accepts(targetFor('Company', 'BlueFlame AI'), img('', 'https://www.blueflame.ai/', 'https://www.blueflame.ai/logo.png')), true);
  });
  test('people need every name token', () => {
    assert.equal(accepts({ kind: 'named', entity: 'Ray Lee' }, img('Ray Lee - BlueFlame AI | LinkedIn')), true);
    assert.equal(accepts({ kind: 'named', entity: 'Ray Lee' }, img('Lee Kuan Yew')), false);
    assert.equal(accepts(targetFor('Steph', '10 pts', undefined, { corpus: 'Steph Curry hits three' }), img('Steph Curry hits three')), true);
  });
  test('one-word labels need proper-noun evidence; stat metrics never get a photo (t443 Points regression)', () => {
    assert.equal(targetFor('Points', '20').kind, 'none');
    assert.equal(targetFor('Steph', '10 pts').kind, 'none', 'no result text: no evidence');
    assert.equal(targetFor('Highlights', '3', undefined, { corpus: 'Clifford highlights from the Kings win. Highlights: dunk' }).kind, 'none');
    assert.equal(targetFor('Lendeborg', 'Warriors', undefined, { corpus: 'Yaxel Lendeborg shines. Lendeborg scored 12' }).kind, 'named');
  });
  test('optional t444 entity hint: aliases and official domains', () => {
    const hintFor = (e: string) => (e === 'Ray Lee' ? { name: 'Raymond Lee', aliases: ['R. J. Lee'] } : e === 'BlueFlame AI' ? { domains: ['blueflameai.com'] } : undefined);
    const ray = targetFor('Ray Lee', '', undefined, { hintFor });
    assert.equal(accepts(ray, img('Raymond Lee portrait')), true);
    assert.equal(accepts(ray, img('Ray Lee headshot')), true);
    assert.equal(accepts(ray, img('Lee Kuan Yew')), false);
    const org = targetFor('Company', 'BlueFlame AI', undefined, { hintFor });
    assert.equal(accepts(org, img('', 'https://cdn.blueflameai.com/x', 'https://cdn.blueflameai.com/logo.png')), true);
    assert.equal(accepts(targetFor('Company', 'BlueFlame AI'), img('', 'https://cdn.example.com/x', 'https://cdn.example.com/logo.png')), false);
  });
});

describe('t444 entity context: no namesake photos', () => {
  const img = (title: string, url = 'https://x.com/p', thumb = 'https://x.com/p.jpg') => ({ title, url, thumb });
  test('a chosen person needs their org word (or own domain) in the picture', () => {
    const hintFor = () => ({ name: 'Ray Lee', domains: ['rayconglobal.com'], context: ['Raycon Inc.'] });
    const t = targetFor('Ray Lee', '', undefined, { hintFor });
    assert.equal(accepts(t, img('Ray Lee - Football - Eastern Michigan', 'https://emueagles.com/roster/ray-lee', 'https://images.sidearmdev.com/crop?x=1')), false);
    assert.equal(accepts(t, img('Raycon co-founder Ray Lee')), true);
    assert.equal(accepts(t, img('Ray Lee', 'https://rayconglobal.com/about', 'https://cdn.rayconglobal.com/ray.jpg')), true);
  });
  test('t451: a single-entity card whose ask names no org takes a full-name photo without the org word', () => {
    const hintFor = () => ({ name: 'David Kim', domains: ['philorch.org'], context: ['Philadelphia Orchestra'] });
    const t = targetFor('David Kim', '', undefined, { hintFor });
    assert.equal(accepts(t, img('David Kim, violinist', 'https://en.wikipedia.org/wiki/David_Kim_(violinist)', 'https://upload.wikimedia.org/dk.jpg')), true);
    assert.equal(accepts(t, img('David Kim - Basketball - State University', 'https://stateathletics.com/roster/david-kim', 'https://images.sidearmdev.com/crop?x=2')), false, 'a roster page names another org');
    assert.equal(accepts(t, img('David Kim', 'https://rocketreach.co/david-kim', 'https://rocketreach.co/dk.jpg')), false, 'people-search page');
    assert.equal(accepts(t, img('David Kim', 'https://cs.someschool.edu/~dkim', 'https://cs.someschool.edu/dk.jpg')), false, '.edu page');
    assert.equal(accepts(t, img('Kim playing', 'https://x.com/p', 'https://x.com/p.jpg')), false, 'still needs the full name');
  });
  test('t451: an ask that names the org takes a full-name photo but not one whose page names another org', () => {
    const hintFor = () => ({ name: 'Ray Lee', domains: ['blueflame.ai'], context: ['BlueFlame AI'], strict: true });
    const t = targetFor('Ray Lee', '', undefined, { hintFor });
    assert.equal(accepts(t, img('Ray Lee portrait', 'https://news.example.com/ray-lee', 'https://news.example.com/r.jpg')), true);
    assert.equal(accepts(t, img('BlueFlame co-founder Ray Lee')), true);
    assert.equal(accepts(t, img('Ray Lee, partner at Acme Capital', 'https://acme.example/team', 'https://acme.example/r.jpg')), false);
    assert.equal(accepts(t, img('Ray Lee - Football - Eastern Michigan', 'https://emueagles.com/roster/ray-lee', 'https://images.sidearmdev.com/crop?x=1')), false);
  });
  test('t451: stat/role labels stay photo-free under the relaxed rule', () => {
    const hintFor = (label: string) => (label === 'David Kim' ? { name: 'David Kim', context: ['Philadelphia Orchestra'] } : undefined);
    assert.equal(targetFor('Points', '', undefined, { hintFor }).kind, 'none');
  });
});
