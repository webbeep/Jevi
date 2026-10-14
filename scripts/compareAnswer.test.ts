import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { SearchResponse } from '../shared/types.ts';
import { asksToCompare } from '../server/askGuard.ts';
import { answersComparison, comparisonNodes, comparisonRepair, comparisonTitle, mentionsSide } from '../server/compareAnswer.ts';
import { candidates } from '../server/extract.ts';
import { compareSideQueries } from '../server/patterns.ts';
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
  assert.deepEqual(compareSideQueries(ASK), ['2026 NBA rookies', 'NBA past draft classes']);
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
