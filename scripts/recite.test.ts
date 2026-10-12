import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { citedSources, Grounding, SourceNumbers } from '../server/ground.ts';

const sources = new SourceNumbers([
  { n: 1, text: 'Pixel 10 has a 4,970 mAh battery and 30W charging.' },
  { n: 2, text: 'iPhone 17 review: great screen, lagged behind rivals in drain tests.' },
  { n: 3, text: 'The iPhone 17 battery is 3,692 mAh and lasts up to 30 hours of video.' },
  { n: 4, text: 'Released 2025.' },
]);

test('a number its citation does not state is cited to the page that does', () => {
  assert.equal(sources.text('The iPhone 17 has a 3,692 mAh battery [2].'), 'The iPhone 17 has a 3,692 mAh battery [3].');
});

test('a citation that states one of the numbers is kept beside the page for the rest', () => {
  assert.equal(sources.text('Pixel 10: 4,970 mAh vs iPhone 17: 3,692 mAh [1].'), 'Pixel 10: 4,970 mAh vs iPhone 17: 3,692 mAh [1][3].');
});

test('a backed sentence, an uncited sentence and small counts are left alone', () => {
  const backed = 'Pixel 10 charges at 30W [1]. It has 2 cameras [2]. Up to 30 hours of video.';
  assert.equal(sources.text(backed), backed);
});

test('a number no source states keeps its citation', () => {
  assert.equal(sources.text('It costs 799 dollars [2].'), 'It costs 799 dollars [2].');
});

test('each sentence is checked against its own citation', () => {
  assert.equal(
    sources.text('Pixel 10 has 4,970 mAh [3]. The iPhone 17 lasts 30 hours [3].'),
    'Pixel 10 has 4,970 mAh [1]. The iPhone 17 lasts 30 hours [3].',
  );
});

test('markers without a space before them stay that way', () => {
  assert.equal(sources.text('3,692 mAh[2]'), '3,692 mAh[3]');
});

test('table cells and nested tiles are re-cited and relinked', () => {
  const node: CardNode = {
    type: 'stack',
    children: [
      { type: 'table', columns: ['Phone', 'Battery'], rows: [['iPhone 17', '3,692 mAh [1]'], ['Pixel 10', '4,970 mAh [1]']] },
      { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'iPhone 17', value: '3,692 mAh', source: 1 }, { type: 'tile', label: 'Pixel 10', value: '4,970 mAh', source: 1 }] },
      { type: 'list', items: [{ text: 'iPhone 17 battery 3,692 mAh', source: 2 }, { text: 'No numbers here' }] },
    ],
  };
  assert.deepEqual(sources.node(node), {
    type: 'stack',
    children: [
      { type: 'table', columns: ['Phone', 'Battery'], rows: [['iPhone 17', '3,692 mAh [3]'], ['Pixel 10', '4,970 mAh [1]']] },
      { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'iPhone 17', value: '3,692 mAh', source: 3 }, { type: 'tile', label: 'Pixel 10', value: '4,970 mAh', source: 1 }] },
      { type: 'list', items: [{ text: 'iPhone 17 battery 3,692 mAh', source: 3 }, { text: 'No numbers here' }] },
    ],
  });
});

test('code and drafts are never treated as cited', () => {
  const code: CardNode = { type: 'code', language: 'js', code: 'const x = arr[1] + 3692;' };
  assert.deepEqual(sources.node({ type: 'stack', children: [code] }), { type: 'stack', children: [code] });
});

test('grounding without source numbers leaves citations as written', () => {
  const node: CardNode = { type: 'text', text: '3,692 mAh [1].' };
  assert.deepEqual(new Grounding('3692').recite(node), node);
  assert.deepEqual(new Grounding('3692', false, sources).recite(node), { type: 'text', text: '3,692 mAh [3].' });
});

test('the citation list gains the page behind a number that has no citation of its own', () => {
  const body: CardNode[] = [
    { type: 'hero', value: '3,692', unit: 'mAh', label: 'iPhone 17 battery' },
    { type: 'tile', label: 'Pixel 10', value: '4,970 mAh', source: 1 },
    { type: 'actions', items: [{ label: 'Compare 2025 phones', query: 'best phones 2025' }] },
    { type: 'citations', refs: [1] },
  ];
  assert.deepEqual([...citedSources(body)], [1]);
  assert.deepEqual(sources.missingRefs(body), [3]);
  assert.deepEqual(sources.missingRefs([...body.slice(0, 3), { type: 'citations', refs: [1, 3] }]), []);
});

test('pictures, next steps and numbers no source states add nothing to the citation list', () => {
  const body: CardNode[] = [
    { type: 'tile', label: 'Phone', value: 'Fast', imageSrc: 'https://img.example/3692.jpg' },
    { type: 'text', text: 'About 799 dollars.' },
    { type: 'choices', options: [{ label: '2025 models', prompt: 'phones released 2025' }] },
  ];
  assert.deepEqual(sources.missingRefs(body), []);
});
