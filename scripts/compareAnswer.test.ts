import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { SearchResponse } from '../shared/types.ts';
import { asksToCompare } from '../server/askGuard.ts';
import { answersComparison, comparisonNodes, comparisonRepair, comparisonTitle, keepComparedProducts, mentionsSide, missingSideNode, sameProduct } from '../server/compareAnswer.ts';
import { candidates } from '../server/extract.ts';
import { compareSideQueries, compareSides } from '../server/patterns.ts';
import { Polisher, completeSentences, emptyFigure, withoutEmptySlots } from '../server/polish.ts';

const ASK = 'AJ Dybantsa vs 2026 NBA rookies vs past draft classes';
const CLIPPED = 'Get to Know AJ Dybantsa · Led the nation in scoring (25.5 ppg), total points (894), field goals made (308) and free throws made (229). · First player in Big 12 …';

test('a trailing ellipsis keeps the last finished sentence, including decimals', () => {
  const done = completeSentences(CLIPPED);
  assert.match(done, /25\.5 ppg/);
  assert.match(done, /\(229\)\./);
  assert.doesNotMatch(done, /Big 12/);
  assert.doesNotMatch(done, /…|\.\.\./);
  assert.equal(completeSentences('He led the nation in scoring.'), 'He led the nation in scoring.');
  assert.equal(completeSentences('First player in Big 12 …'), '');
  assert.equal(withoutEmptySlots('In he founded Eureka Labs.'), 'He founded Eureka Labs.');
  assert.equal(withoutEmptySlots('In [year] he founded Eureka Labs.'), 'He founded Eureka Labs.');
  assert.equal(withoutEmptySlots('Karpathy founded Eureka Labs in .'), 'Karpathy founded Eureka Labs.');
  assert.equal(withoutEmptySlots('Minnesota has about wolves.'), '');
  assert.match(withoutEmptySlots('The best estimate of reaching 1. 5°C stands.'), /reaching 1\.5°C/);
  assert.equal(emptyFigure('Unknown'), true);
  assert.equal(emptyFigure('11,842'), false);
  assert.equal(new Polisher(200).apply({ type: 'stat', label: 'FDA cases', value: 'Unknown' }), undefined);
});

test('a short text cap does not split a decimal into a sentence', () => {
  const node = new Polisher(80).apply({
    type: 'text',
    text: 'He averaged 25.5 points per game in college and led the nation in scoring every night. A second sentence that the cap should leave out of the card entirely.',
  });
  assert.equal(node?.type, 'text');
  if (node?.type !== 'text') return;
  assert.match(node.text, /25\.5 points/);
  assert.doesNotMatch(node.text, /second sentence/i);
  assert.doesNotMatch(node.text, /…|\.\.\./);
});

function search(snippet: string): SearchResponse {
  return {
    query: ASK,
    results: [{ title: 'Get to Know AJ Dybantsa', url: 'https://example.com/aj', snippet, domain: 'example.com', engines: ['web'] }],
    images: [],
    engines: [],
  };
}

test('snippet sentences are not stored already cut off', () => {
  const texts = candidates(search(CLIPPED)).map((c) => c.text);
  assert.ok(texts.some((t) => t.includes('25.5') && t.includes('(229).')));
  assert.ok(texts.every((t) => !/…|\.\.\.|Big 12/.test(t)));
});

test('a comparison follow-up is searched on its own, and a pronoun one is not', () => {
  assert.equal(asksToCompare(ASK), true);
  assert.equal(asksToCompare('compare this with the other one'), false);
  assert.deepEqual(compareSideQueries(ASK), ['2026 NBA rookies', 'NBA past draft classes', 'AJ Dybantsa']);
});

test('the card title names the sides being compared, not the previous question', () => {
  assert.equal(comparisonTitle(ASK, 'Nba preseason standouts yesterday'), 'AJ Dybantsa vs 2026 NBA Rookies vs Draft Classes');
  assert.equal(comparisonTitle(ASK, ASK), 'AJ Dybantsa vs 2026 NBA Rookies vs Draft Classes');
  assert.equal(comparisonTitle(ASK, 'Dybantsa vs Rookies'), 'Dybantsa vs Rookies');
});

test('a biography of one side is not an answer, and the fallback finishes the sentence', () => {
  const bio: CardNode = { type: 'text', text: CLIPPED, size: 'lg' };
  const points: CardNode = {
    type: 'section',
    title: 'Key points',
    children: [{ type: 'list', style: 'check', items: [{ text: CLIPPED, meta: 'facebook.com' }] }],
  };
  assert.equal(answersComparison(ASK, [bio, points]), false);
  assert.equal(mentionsSide('past draft classes', 'He is a draft prospect.'), false);
  const nodes = comparisonNodes(ASK, search(CLIPPED));
  const blob = JSON.stringify(nodes);
  assert.match(blob, /AJ Dybantsa/);
  assert.match(blob, /25\.5 ppg/);
  assert.match(blob, /2026 NBA Rookies/);
  assert.match(blob, /Draft Classes/);
  assert.doesNotMatch(blob, /…|\.\.\.|Big 12|preseason standouts/);
  const shown = new Map<number, CardNode>([[0, bio], [1, points]]);
  const patches = comparisonRepair(ASK, search(CLIPPED), shown);
  assert.ok(patches);
  assert.equal(patches![0]?.index, 0);
  assert.equal(patches![0]?.node.type, 'stack');
  assert.equal(patches![1]?.node.type, 'citations');
});

test('a compound product name is the spaced name, and a filled comparison is not replaced', () => {
  const ask = 'Northwatch 2 vs Glowband 4';
  assert.equal(mentionsSide('Glowband 4', 'The Glow Band 4 costs $40'), true);
  assert.equal(mentionsSide('Glowband 4', 'The Glow Band 9 costs $40'), false);
  assert.equal(mentionsSide('past draft classes', 'He is a draft prospect.'), false);
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch 2', value: '$90' },
      { type: 'tile', label: 'Glow Band 4', value: '$40' },
    ],
  };
  const table: CardNode = {
    type: 'table',
    columns: ['Factor', 'Northwatch 2', 'Glow Band 4'],
    rows: [['Price', '$90', '$40'], ['Display', 'OLED', 'AMOLED']],
  };
  assert.equal(answersComparison(ask, [tiles, table]), true);
  const shown = new Map<number, CardNode>([[0, tiles], [1, table]]);
  assert.equal(comparisonRepair(ask, search('Only one side is discussed here.'), shown), undefined);
});

test('a list of products is one side each, and a follow-up keeps the price and picture already shown', () => {
  assert.deepEqual(compareSides('Compare Northwatch 2, Glowband 4 and Harbor Band 8'), ['Northwatch 2', 'Glowband 4', 'Harbor Band 8']);
  assert.equal(sameProduct('Northwatch 2', 'Northwatch Air'), false);
  assert.equal(sameProduct('Northwatch 2', 'Northwatch 2'), true);
  const prior: CardNode[] = [{
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch 2', value: '$179.99', imageSrc: 'https://img.example/north.png' },
      { type: 'tile', label: 'Glowband 4', value: '$48', imageSrc: 'https://img.example/glow.png' },
    ],
  }];
  const next = new Map<number, CardNode>([[0, {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch 2', value: '$99' },
      { type: 'tile', label: 'Northwatch Air', value: '$80' },
      { type: 'tile', label: 'Glow Band 4', value: '$48' },
    ],
  }], [1, {
    type: 'table',
    columns: ['Factor', 'Northwatch 2', 'Glow Band 4'],
    rows: [['Price', '$99', 'Not stated in sources'], ['Display', 'Not stated in sources', 'AMOLED']],
  }]]);
  const patches = keepComparedProducts(prior, next, 'Compare Northwatch 2, Northwatch Air and Glowband 4');
  assert.ok(patches);
  const grid = patches!.find((patch) => patch.index === 0)?.node;
  assert.equal(grid?.type, 'grid');
  if (grid?.type !== 'grid') return;
  const edge = grid.children.find((node) => node.type === 'tile' && node.label === 'Northwatch 2');
  const air = grid.children.find((node) => node.type === 'tile' && node.label === 'Northwatch Air');
  const glow = grid.children.find((node) => node.type === 'tile' && node.label === 'Glow Band 4');
  assert.equal(edge?.type === 'tile' ? edge.value : '', '$179.99');
  assert.equal(edge?.type === 'tile' ? edge.imageSrc : '', 'https://img.example/north.png');
  assert.equal(air?.type === 'tile' ? air.value : '', '$80');
  assert.equal(glow?.type === 'tile' ? glow.imageSrc : '', 'https://img.example/glow.png');
  const table = patches!.find((patch) => patch.index === 1)?.node;
  assert.equal(table?.type, 'table');
  if (table?.type !== 'table') return;
  assert.deepEqual(table.rows[0], ['Price', '$179.99', '$48']);
  const added = missingSideNode('Compare Northwatch 2, Glowband 4 and Harbor Band 8', [
    { type: 'tile', label: 'Northwatch 2', value: '$90' },
    { type: 'tile', label: 'Glowband 4', value: '$40' },
  ], {
    query: 'Compare Northwatch 2, Glowband 4 and Harbor Band 8',
    results: [{ title: 'Harbor Band 8 review', url: 'https://example.com/harbor', snippet: 'The Harbor Band 8 costs $60 and lasts a week.', domain: 'example.com', engines: ['web'] }],
    images: [],
    engines: [],
  });
  assert.equal(added?.type, 'grid');
  if (added?.type !== 'grid') return;
  const harbor = added.children[0];
  assert.equal(harbor?.type === 'tile' ? harbor.label : '', 'Harbor Band 8');
  assert.equal(harbor?.type === 'tile' ? harbor.value : '', '$60');
});
