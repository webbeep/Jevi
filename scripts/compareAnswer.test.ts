import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { SearchResponse } from '../shared/types.ts';
import { asksToCompare } from '../server/askGuard.ts';
import { acceptProductPhoto, answersComparison, comparisonNodes, comparisonRepair, comparisonTitle, keepComparedProducts, mentionsSide, missingSideNode, nameForms, sameProduct, showsComparison } from '../server/compareAnswer.ts';
import { candidates } from '../server/extract.ts';
import { compareSideQueries, compareSides, withoutLeadVerb } from '../server/patterns.ts';
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

test('a one-word product is also searched as the spaced name the sources use', () => {
  assert.deepEqual(nameForms('Glowband', 'Reviewed the Harbor Glow Band against the Northwatch.'), ['Glowband', 'Glow Band', 'Harbor Glow Band']);
  assert.deepEqual(nameForms('Northwatch 2', 'The Northwatch 2 costs $90.'), ['Northwatch 2']);
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

test('a relative phrase is not a price when the source states one', () => {
  const ask = 'Northwatch 2 versus Glowband 4';
  const table: CardNode = {
    type: 'table',
    columns: ['Factor', 'Northwatch 2', 'Glowband 4'],
    rows: [['Price', 'Costs more', '$30–$40 cheaper']],
  };
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch 2', value: 'Costs more' },
      { type: 'tile', label: 'Glowband 4', value: '$30–$40 cheaper' },
    ],
  };
  const priced: SearchResponse = {
    query: ask,
    freshness: 'any',
    results: [
      { title: 'Northwatch 2', url: 'https://example.com/north', snippet: 'The Northwatch 2 is $189.99.', domain: 'example.com', engines: ['web'] },
      { title: 'Glowband 4', url: 'https://example.com/glow', snippet: 'The Glowband 4 is $79.00.', domain: 'example.com', engines: ['web'] },
    ],
    images: [
      { url: 'https://example.com/north', thumb: 'https://example.com/north.jpg', title: 'Northwatch 2', source: 'Northwatch 2', license: 'source' },
    ],
    discussions: [],
    engines: ['web'],
  };
  const patches = comparisonRepair(ask, priced, new Map([[0, tiles], [1, table]]));
  const blob = JSON.stringify(patches);
  assert.match(blob, /\$189\.99/);
  assert.match(blob, /\$79\.00/);
  assert.match(blob, /north\.jpg/);
  assert.doesNotMatch(blob, /cheaper|Costs more/);
});

test('a verdict sentence is not the comparison, so both sides become tiles', () => {
  const ask = 'Northwatch 2 versus Glowband 4';
  const verdict: CardNode = { type: 'text', text: 'Pick the Northwatch 2 for the brighter screen and the Glowband 4 for the lower price.', size: 'lg' };
  assert.equal(showsComparison(ask, [verdict]), false);
  const shown = new Map<number, CardNode>([[0, verdict]]);
  const search: SearchResponse = {
    query: ask,
    freshness: 'any',
    results: [
      { title: 'Northwatch 2', url: 'https://example.com/north', snippet: 'The Northwatch 2 costs $90.', domain: 'example.com', engines: ['web'] },
      { title: 'Glowband 4', url: 'https://example.com/glow', snippet: 'The Glowband 4 costs $40.', domain: 'example.com', engines: ['web'] },
    ],
    images: [
      { url: 'https://example.com/north', thumb: 'https://example.com/north.jpg', title: 'Northwatch 2', source: 'Northwatch 2', license: 'source' },
      { url: 'https://example.com/glow', thumb: 'https://example.com/glow.jpg', title: 'Glow Band 4', source: 'Glow Band 4', license: 'source' },
    ],
    discussions: [],
    engines: ['web'],
  };
  const patches = comparisonRepair(ask, search, shown);
  assert.ok(patches);
  const blob = JSON.stringify(patches);
  assert.match(blob, /Northwatch 2/);
  assert.match(blob, /Glow Band 4|Glowband 4/);
  assert.match(blob, /\$90/);
  assert.match(blob, /\$40/);
  assert.match(blob, /north\.jpg/);
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
  assert.equal(withoutLeadVerb('Compare Harbor Slate'), 'Harbor Slate');
  assert.deepEqual(compareSides('Compare Harbor Slate vs Northwatch 2'), ['Harbor Slate', 'Northwatch 2']);
  assert.deepEqual(compareSides('Explain Harbor Slate vs Northwatch 2'), ['Harbor Slate', 'Northwatch 2']);
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
      { type: 'tile', label: 'Northwatch 2', value: '$99', imageSrc: 'https://img.example/other.png' },
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

test('two figures for one product are the same price, or the other is a labeled offer', () => {
  const ask = 'Harbor Slate versus Northwatch 2';
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Harbor Slate', value: '$299.99' },
      { type: 'tile', label: 'Northwatch 2', value: '$549' },
    ],
  };
  const table: CardNode = {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [['Starting price', '$549.99 (5G, Verizon)', '$549']],
  };
  const search: SearchResponse = {
    query: ask,
    freshness: 'any',
    results: [],
    images: [],
    discussions: [],
    engines: [],
  };
  const patches = comparisonRepair(ask, search, new Map([[0, tiles], [1, table]]));
  const nextTable = patches?.find((patch) => patch.index === 1)?.node;
  assert.equal(nextTable?.type, 'table');
  if (nextTable?.type !== 'table') return;
  assert.equal(nextTable.rows[0]?.[1], '$299.99');
  assert.equal(nextTable.rows[0]?.[2], '$549');
  const offer = nextTable.rows.find((row) => row[0] === 'Verizon price');
  assert.deepEqual(offer, ['Verizon price', '$549.99', '']);
  const plain: CardNode = {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [['Starting price', '$549.99', '$549']],
  };
  const collapsed = comparisonRepair(ask, search, new Map([[0, tiles], [1, plain]]));
  const collapsedTable = collapsed?.find((patch) => patch.index === 1)?.node;
  assert.equal(collapsedTable?.type === 'table' ? collapsedTable.rows.length : 0, 1);
  assert.equal(collapsedTable?.type === 'table' ? collapsedTable.rows[0]?.[1] : '', '$299.99');
});

test('a later comparison keeps a measured spec when the new cell has no measurement', () => {
  const prior: CardNode[] = [{
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Harbor Slate', value: '$179.99' },
      { type: 'tile', label: 'Northwatch 2', value: '$34.99' },
    ],
  }, {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [
      ['Display', '1.34 AMOLED', '1.72 AMOLED'],
      ['Weight', '17.7 g without band', '15.95 g'],
      ['Price', '$179.99', '$34.99'],
    ],
  }];
  const next = new Map<number, CardNode>([[0, {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [
      ['Display', 'Vibrant, glanceable [1]', '1.72 AMOLED, 212 x 520 px [8]'],
      ['Water resistance', '—', '5ATM'],
      ['Price', '—', '$34.99'],
    ],
  }]]);
  const patches = keepComparedProducts(prior, next, 'Compare Harbor Slate vs Northwatch 2');
  const table = patches?.find((patch) => patch.index === 0)?.node;
  assert.equal(table?.type, 'table');
  if (table?.type !== 'table') return;
  const cell = (factor: string, column: number) => table.rows.find((row) => row[0] === factor)?.[column];
  assert.equal(cell('Display', 1), '1.34 AMOLED');
  assert.equal(cell('Display', 2), '1.72 AMOLED, 212 x 520 px [8]');
  assert.equal(cell('Weight', 1), '17.7 g without band');
  assert.equal(cell('Weight', 2), '15.95 g');
  assert.equal(cell('Price', 1), '$179.99');
  assert.equal(cell('Price', 2), '$34.99');
  assert.equal(cell('Water resistance', 2), '5ATM');
  const unheaded = keepComparedProducts(prior, new Map([[0, {
    type: 'table',
    columns: ['Harbor Slate', 'Northwatch 2'],
    rows: [['Display', 'Glanceable display [2]', '1.72 AMOLED']],
  }]]), 'Compare Harbor Slate vs Northwatch 2');
  const shifted = unheaded?.find((patch) => patch.index === 0)?.node;
  assert.equal(shifted?.type, 'table');
  if (shifted?.type !== 'table') return;
  assert.equal(shifted.rows.find((row) => row[0] === 'Display')?.[1], '1.34 AMOLED');
  assert.equal(shifted.rows.find((row) => row[0] === 'Display')?.[2], '1.72 AMOLED');
});

test('a promo page is not a product photo, and a stated spec fills a blank cell', () => {
  assert.equal(acceptProductPhoto('Harbor Slate', 'Harbor Slate on a white table', 'A product photo.'), true);
  assert.equal(acceptProductPhoto('Harbor Slate', 'Earn rewards every day', 'The Harbor Slate is mentioned in this airdrop.'), false);
  assert.equal(acceptProductPhoto('Harbor Slate', 'Harbor Slate vs Northwatch 2', 'Both bands.'), false);
  const ask = 'Harbor Slate versus Northwatch 2';
  const table: CardNode = {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [['Battery life', '—', 'Ten days']],
  };
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Harbor Slate', value: '$40' },
      { type: 'tile', label: 'Northwatch 2', value: '$90' },
    ],
  };
  const search: SearchResponse = {
    query: ask,
    freshness: 'any',
    results: [{
      title: 'Harbor Slate specs',
      url: 'https://example.com/slate',
      snippet: 'The Harbor Slate battery lasts 16 days.',
      domain: 'example.com',
      engines: ['web'],
    }],
    images: [],
    discussions: [],
    engines: [],
  };
  const patches = comparisonRepair(ask, search, new Map([[0, tiles], [1, table]]));
  const next = patches?.find((patch) => patch.index === 1)?.node;
  assert.equal(next?.type === 'table' ? next.rows[0]?.[1] : '', '16 days');
  assert.equal(next?.type === 'table' ? next.rows[0]?.[2] : '', 'Ten days');
  const slogan: CardNode = {
    type: 'table',
    columns: ['Factor', 'Harbor Slate', 'Northwatch 2'],
    rows: [['Display', 'Vibrant, glanceable', '1.72 AMOLED']],
  };
  const sized = comparisonRepair(ask, {
    ...search,
    results: [{
      title: 'Harbor Slate specs',
      url: 'https://example.com/slate',
      snippet: 'The Harbor Slate display is a 1.34-inch AMOLED.',
      domain: 'example.com',
      engines: ['web'],
    }],
  }, new Map([[0, slogan]]));
  const sizedTable = sized?.find((patch) => patch.index === 0)?.node;
  assert.equal(sizedTable?.type === 'table' ? sizedTable.rows[0]?.[1] : '', '1.34-inch');
  assert.equal(sizedTable?.type === 'table' ? sizedTable.rows[0]?.[2] : '', '1.72 AMOLED');
  const mixed = comparisonRepair(ask, {
    ...search,
    results: [{
      title: 'Harbor Slate specs',
      url: 'https://example.com/slate',
      snippet: 'The Harbor Slate has a 7-day battery and a glanceable display.',
      domain: 'example.com',
      engines: ['web'],
    }],
  }, new Map([[0, slogan]]));
  const mixedTable = mixed?.find((patch) => patch.index === 0)?.node;
  const mixedCell = mixedTable?.type === 'table' ? mixedTable.rows[0]?.[1] : 'Vibrant, glanceable';
  assert.equal(mixedCell, 'Vibrant, glanceable');
});

test('a verdict does not deny a price the card already shows', () => {
  const ask = 'Fitbit Edge vs Mi Band 10';
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Fitbit Edge', value: '$179' },
      { type: 'tile', label: 'Mi Band 10', value: '$34.99' },
    ],
  };
  const table: CardNode = {
    type: 'table',
    columns: ['Factor', 'Fitbit Edge', 'Mi Band 10'],
    rows: [
      ['Price', '$179', '$34.99'],
      ['Display', 'Glanceable display', '1.72 AMOLED, 212 x 520 px, 1,500 nits'],
    ],
  };
  const verdict: CardNode = {
    type: 'callout',
    tone: 'muted',
    title: 'Verdict',
    text: 'Pick the Mi Band 10 for a 1.72 AMOLED screen and 21-day battery. Sources state no Fitbit Edge price.',
  };
  const search: SearchResponse = {
    query: ask,
    freshness: 'any',
    results: [
      { title: 'Fitbit Edge', url: 'https://store.google.com/edge', snippet: 'A fitness tracker with coaching.', domain: 'store.google.com', engines: ['web'] },
      { title: 'Mi Band 10', url: 'https://www.mi.com/band-10', snippet: 'A 1.72 AMOLED display and 21 days of battery.', domain: 'mi.com', engines: ['web'] },
    ],
    images: [],
    discussions: [],
    engines: [],
  };
  const patches = comparisonRepair(ask, search, new Map([[0, tiles], [1, table], [2, verdict]]));
  const verdictPatch = patches?.find((patch) => patch.index === 2)?.node;
  const verdictText = verdictPatch?.type === 'callout' ? verdictPatch.text : '';
  assert.equal(verdictText, 'Pick the Mi Band 10 for a 1.72 AMOLED screen and 21-day battery.');
  assert.equal(patches?.some((patch) => patch.index === 0 || patch.index === 1), false);
  const named = { ...verdict, text: 'Pick the Edge for a 1.34-inch screen. No source states a price for the Edge, so cost can\'t be compared.' };
  const again = comparisonRepair(ask, search, new Map([[0, tiles], [1, table], [2, named]]));
  const againText = again?.find((patch) => patch.index === 2)?.node;
  assert.equal(againText?.type === 'callout' ? againText.text : '', 'Pick the Edge for a 1.34-inch screen.');
});
