import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { ImageResult, SearchResult } from '../shared/types.ts';
import { PictureResolver } from '../server/pictures.ts';
import { properName, targetFor } from '../server/imageGate.ts';
import { personFacts, profileFallback } from '../server/profileFallback.ts';
import { priorEntity, resolveEntity } from '../server/entity.ts';
import type { Env } from '../server/util.ts';

const pic = (title: string, thumb: string, url = thumb): ImageResult => ({ url, thumb, title, source: new URL(url).hostname, license: 'source' });

const pool: ImageResult[] = [
  pic('Timothy Estrada - Software Engineer', 'https://media.licdn.com/tim-estrada.jpg', 'https://www.linkedin.com/in/tim-estrada'),
  pic('Blueflame AI by Datasite', 'https://blueflame.ai/logo.png', 'https://blueflame.ai/'),
  pic('Welcome to the team - Blueflame AI', 'https://blueflame.ai/team.png', 'https://blueflame.ai/blog/team'),
  pic('As a former investor, I would make Blueflame', 'https://i.ytimg.com/vi/x/hq.jpg', 'https://www.youtube.com/watch?v=x'),
  pic('Raj Bakhru, CEO of Blueflame AI', 'https://blueflame.ai/raj.jpg', 'https://blueflame.ai/about'),
];

const rows: SearchResult[] = [
  { title: 'Timothy Estrada - BlueFlame AI', url: 'https://www.linkedin.com/in/tim-estrada', domain: 'linkedin.com', engines: ['web'], snippet: 'As a Software Engineer at Eco-Enterprise, I direct the architectural design and evolution… · Experience: BlueFlame AI · Education: New Jersey Institute of Technology · Location: New York' },
  { title: 'Blueflame AI | AI Deal Intelligence', url: 'https://blueflame.ai/', domain: 'blueflame.ai', engines: ['web'], snippet: 'Access certified case records and legal filings with Blueflame.' },
];

const hint = (label: string) => (/estrada/i.test(label) ? { name: 'Timothy Estrada', context: ['blueflame'], domains: ['linkedin.com'] } : undefined);

function personResolver(shown: CardNode[]) {
  return new PictureResolver({} as Env, pool, () => undefined, 'Timothy Estrada BlueFlame AI', async () => [], { results: rows, hintFor: hint, person: 'Timothy Estrada' });
}

test('a label that ends on a joining word is not a name', () => {
  assert.equal(properName('Also at'), false);
  assert.equal(properName('Based in'), false);
  assert.equal(properName('Bank of America'), true);
  assert.equal(targetFor('Also at', 'BlueFlame AI').kind, 'none');
});

test('a one-person card only shows that person: no logos, team graphics, video stills or colleagues', () => {
  const shown: CardNode[] = [];
  const resolver = personResolver(shown);
  resolver.emit({ type: 'gallery', refs: [0, 1, 2, 3, 4] }, 0, (n) => shown.push(n));
  const gallery = shown[0];
  assert.equal(gallery?.type, 'gallery');
  if (gallery?.type === 'gallery') assert.deepEqual(gallery.refs, [0]);
});

test('tiles on a one-person card keep their icons instead of a company logo or a book cover', () => {
  const shown: CardNode[] = [];
  const resolver = personResolver(shown);
  resolver.emit({
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Company', value: 'BlueFlame AI', icon: 'building-2', imageRef: 1 },
      { type: 'tile', label: 'Also at', value: 'BlueFlame AI', icon: 'briefcase', imageQuery: 'Also at' },
      { type: 'tile', label: 'Raj Bakhru', value: 'CEO', imageRef: 4 },
    ],
  }, 0, (n) => shown.push(n));
  const grid = shown[0];
  assert.equal(grid?.type, 'grid');
  if (grid?.type !== 'grid') return;
  for (const tile of grid.children) {
    if (tile.type !== 'tile') continue;
    assert.equal(tile.imageRef, undefined, tile.label);
    assert.equal(tile.imageSrc, undefined, tile.label);
  }
});

test('the profile photo on a one-person card is still that person', () => {
  const shown: CardNode[] = [];
  personResolver(shown).emit({ type: 'profile', name: 'Timothy Estrada', imageRef: 0 }, 0, (n) => shown.push(n));
  const profile = shown[0];
  assert.equal(profile?.type === 'profile' ? profile.imageRef : -1, 0);
});

test('a snippet-only person card is the standard profile with a third-person summary', () => {
  const body = profileFallback({ name: 'Timothy Estrada', role: 'Engineer', org: 'Eco-Enterprise' }, rows, pool, hint);
  assert.deepEqual(body.map((n) => n.type), ['profile', 'grid', 'text', 'citations']);
  const [profile, grid, text] = body;
  assert.equal(profile?.type, 'profile');
  if (profile?.type === 'profile') {
    assert.equal(profile.name, 'Timothy Estrada');
    assert.equal(profile.imageRef, 0);
    assert.equal(profile.subtitle, 'Software Engineer · BlueFlame AI');
    assert.deepEqual(profile.facts?.map((f) => f.label), ['Role', 'Company', 'Education', 'Location']);
  }
  if (grid?.type === 'grid') assert.deepEqual(grid.children.map((t) => (t.type === 'tile' ? t.label : '')), ['Role', 'Company', 'Education']);
  assert.equal(text?.type, 'text');
  if (text?.type === 'text') {
    assert.doesNotMatch(text.text, /(^|\s)(I|my|me)\s/);
    assert.match(text.text, /^Timothy Estrada is a Software Engineer at Eco-Enterprise \[1\]\./);
    assert.match(text.text, /BlueFlame AI/);
    assert.match(text.text, /New Jersey Institute of Technology/);
  }
  assert.ok(!body.some((n) => n.type === 'gallery' || n.type === 'section'));
});

test('a snippet-only person card never shows another person as its photo', () => {
  const body = profileFallback({ name: 'Timothy Estrada' }, rows, pool.slice(1), hint);
  const profile = body[0];
  assert.equal(profile?.type === 'profile' ? profile.imageRef : 'x', undefined);
});

test('person facts read a prior employer and skip pages about someone else', () => {
  const f = personFacts({ name: 'Dana Ruiz' }, [
    { title: 'Dana Ruiz - Head of Product', url: 'https://example.com/dana', domain: 'example.com', engines: ['web'], snippet: 'Dana Ruiz is Head of Product at Acme Robotics. Previously at Globex Corporation.' },
    { title: 'Sam Lee', url: 'https://example.com/sam', domain: 'example.com', engines: ['web'], snippet: 'Education: Stanford University' },
  ]);
  assert.equal(f.role?.value, 'Head of Product');
  assert.equal(f.company?.value, 'Acme Robotics');
  assert.equal(f.prior?.value, 'Globex Corporation');
  assert.equal(f.education, undefined);
});

test('a picked choice is final: the chosen person resolves to one card, not another picker', () => {
  const at = (title: string, url: string, snippet: string) => ({ title, url, snippet });
  const rows = [
    at('Michael B. Jordan', 'https://en.wikipedia.org/wiki/Michael_B._Jordan', 'Michael Bakari Jordan (born February 9, 1987) is an American actor, producer, and director.'),
    at('Michael B. Jordan', 'https://www.imdb.com/name/nm0430107/', 'Michael B. Jordan was born in Santa Ana, California. He is an actor and director, known for Creed and Black Panther.'),
    at('Films starring Michael B. Jordan', 'https://letterboxd.com/actor/michael-b-jordan/', 'Films starring Michael B. Jordan: Sinners, Creed III, Black Panther.'),
    at('Michael B Jordan - LinkedIn', 'https://www.linkedin.com/in/michaelbjordan', 'Michael B Jordan. Sales associate at Home Depot. Atlanta.'),
  ];
  const prior = priorEntity('Chosen person: Michael B. Jordan — American actor');
  const decision = resolveEntity('Michael B. Jordan', rows, { pattern: 'profile', prior });
  assert.equal(decision.kind, 'single');
});
