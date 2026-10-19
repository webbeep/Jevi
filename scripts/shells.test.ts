import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutShells } from '../shared/shells.ts';
import { GAP_MARK } from '../shared/gap.ts';

test('a table row with no values left is dropped, and a single missing cell reads as a dash', () => {
  const table = { type: 'table' as const, columns: ['', 'iPhone 17', 'Pixel 10'], rows: [['Display', '', '6.3-inch'], ['Cheapest in 50 metros', '', ' '], ['Storage', GAP_MARK, '']] };
  assert.deepEqual(withoutShells(table), { ...table, rows: [['Display', '—', '6.3-inch'], ['Storage', GAP_MARK, '—']] });
  assert.equal(withoutShells({ type: 'table', columns: ['', 'A'], rows: [['Price', '']] }), undefined);
});

test('a citation-only sentence, an empty verdict and an empty key are not shown', () => {
  assert.equal(withoutShells({ type: 'callout', title: 'Verdict', text: '[2][8][10][11]' }), undefined);
  assert.equal(withoutShells({ type: 'text', text: ' [8] ' }), undefined);
  assert.deepEqual(withoutShells({ type: 'keyvalue', items: [{ label: 'RSI14', value: '' }, { label: 'Close', value: '$12.40' }] }), { type: 'keyvalue', items: [{ label: 'Close', value: '$12.40' }] });
  assert.deepEqual(withoutShells({ type: 'tile', label: 'iPhone 17', value: '$799', sub: '″ · · ' }), { type: 'tile', label: 'iPhone 17', value: '$799', sub: undefined });
  const kept = { type: 'stack' as const, children: [{ type: 'text' as const, text: 'Feed it daily [3].' }] };
  assert.equal(withoutShells(kept), kept);
  assert.deepEqual(withoutShells({ type: 'stack', children: [{ type: 'text', text: 'Feed it daily.' }, { type: 'callout', text: '[8]' }] }), { type: 'stack', children: [{ type: 'text', text: 'Feed it daily.' }] });
});

test('a tile or key that only says there is no value is not shown', () => {
  assert.equal(withoutShells({ type: 'tile', label: 'Lakers vs Warriors', value: 'None yet' }), undefined);
  assert.deepEqual(withoutShells({ type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Final', value: 'Unavailable' }, { type: 'tile', label: 'Next game', value: 'Oct 21' }] }), { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Next game', value: 'Oct 21' }] });
  assert.deepEqual(withoutShells({ type: 'keyvalue', items: [{ label: 'Weight', value: 'N/A' }, { label: 'Display', value: '1.34 in' }] }), { type: 'keyvalue', items: [{ label: 'Display', value: '1.34 in' }] });
  const named = { type: 'tile' as const, label: 'Mi Band 10' };
  assert.equal(withoutShells(named), named);
});

test('an empty detail, a repeated item, a citation-only caption and a cite past the sources go', async () => {
  const { withinSources } = await import('../shared/shells.ts');
  assert.deepEqual(withoutShells({ type: 'list', items: [{ text: 'Microsoft pulls out of UK AI data centre [2]', meta: '' }, { text: 'Microsoft pulls out of UK AI data centre', meta: 'Oct' }, { text: 'Nvidia earnings', meta: 'Oct 18' }] }),
    { type: 'list', items: [{ text: 'Microsoft pulls out of UK AI data centre [2]', meta: undefined }, { text: 'Nvidia earnings', meta: 'Oct 18' }] });
  assert.deepEqual(withoutShells({ type: 'hero', value: '10 pts', caption: '[7]' }), { type: 'hero', value: '10 pts', caption: undefined });
  assert.equal(withoutShells({ type: 'tile', label: 'Scores', value: 'Not in sources' }), undefined);
  assert.deepEqual(withinSources({ type: 'text', text: 'Pick the Pixel [3][30].' }, 12), { type: 'text', text: 'Pick the Pixel [3].' });
  // A cell value with a number in brackets that is not a cite is left alone only when it is in range; refs nodes are untouched.
  assert.deepEqual(withinSources({ type: 'citations', refs: [1, 30] }, 12), { type: 'citations', refs: [1, 30] });
});

test('a tile value left as "Under" or "~" after its price went is removed, and the name stays', () => {
  assert.deepEqual(withoutShells({ type: 'tile', label: '2. Soundcore Space One', value: 'Under', sub: 'Great ANC' }), { type: 'tile', label: '2. Soundcore Space One', value: undefined, sub: 'Great ANC' });
  assert.deepEqual(withoutShells({ type: 'tile', label: 'Soundcore Space Q45', value: '~ [1]' }), { type: 'tile', label: 'Soundcore Space Q45', value: undefined });
});

test('a fact another region shows right now is not shown again, and same-price products both stay', async () => {
  const { withoutRepeatedFacts, factsElsewhere } = await import('../shared/shells.ts');
  const shown = new Map<number, CardNode>([[0, { type: 'tile', label: 'Joined Microsoft', value: '1992' }]]);
  assert.equal(withoutRepeatedFacts({ type: 'tile', label: 'Joined', value: '1992 [3]' }, factsElsewhere(shown, 2)), undefined);
  assert.deepEqual(withoutRepeatedFacts({ type: 'keyvalue', items: [{ label: 'Joined Microsoft', value: '1992' }, { label: 'CEO since', value: '2014' }] }, factsElsewhere(shown, 3)),
    { type: 'keyvalue', items: [{ label: 'CEO since', value: '2014' }] });
  // The slot that shows it republishes it unchanged.
  const own: CardNode = { type: 'tile', label: 'Joined Microsoft', value: '1992' };
  assert.equal(withoutRepeatedFacts(own, factsElsewhere(shown, 0)), own);
  const pair: CardNode = { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'iPhone 17', value: '$799' }, { type: 'tile', label: 'Pixel 10', value: '$799' }] };
  assert.equal(withoutRepeatedFacts(pair, factsElsewhere(new Map(), 0)), pair);
});

test('beside priced tiles a tile with no figure and no picture goes; a row of names stays', () => {
  const row: CardNode = { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Pro', sub: 'Per user/mo, monthly' }, { type: 'tile', label: 'Business+', value: '$18', sub: 'Per user/mo' }] };
  assert.deepEqual(withoutShells(row), { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Business+', value: '$18', sub: 'Per user/mo' }] });
  const names: CardNode = { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Fitbit Edge' }, { type: 'tile', label: 'Mi Band 10' }] };
  assert.equal(withoutShells(names), names);
});

test('a numbered pick with no figure stays in its ranking', () => {
  const row: CardNode = { type: 'stack', children: [{ type: 'tile', label: '2. Soundcore Life Q30', value: 'Best value' }, { type: 'tile', label: '3. Sony WH-CH720N', sub: 'Budget ANC' }] };
  assert.equal(withoutShells(row), row);
});

test('a quotation stays only when its words are in the sources', async () => {
  const { withVerbatimQuotes, quoteCorpus } = await import('../shared/shells.ts');
  const corpus = quoteCorpus([
    { title: 'Physical activity guidelines for adults aged 19 to 64', snippet: 'do strengthening activities that work all the major muscle groups (legs, hips, back, abdomen, chest, shoulders and arms) on at least 2 days a week; spread exercise evenly over 4 to 5 days a week' },
    { title: 'The Physical Activity Guidelines for Americans', snippet: 'Adults should do at least 150 minutes to 300 minutes a week of moderate-intensity aerobic physical activity.' },
  ], []);
  const kv: CardNode = { type: 'keyvalue', items: [
    { label: 'Strength training', value: '"do strengthening activities that work all the major muscle groups ... on at least 2 days a week" [5]' },
    { label: 'Spread over', value: '"Exercise " Physical activity guidelines for adults aged 19 to 64"." [5]' },
  ] };
  assert.deepEqual(withVerbatimQuotes(kv, corpus), { type: 'keyvalue', items: [kv.type === 'keyvalue' ? kv.items[0]! : { label: '', value: '' }] });
  const line: CardNode = { type: 'text', text: 'The guideline says “Adults should do at least 150 minutes to 300 minutes a week of moderate-intensity aerobic physical activity.” [4] It also says “adults must jog daily for an hour” [9].' };
  assert.deepEqual(withVerbatimQuotes(line, corpus), { type: 'text', text: 'The guideline says “Adults should do at least 150 minutes to 300 minutes a week of moderate-intensity aerobic physical activity.” [4]' });
});

test('a price cut off at its figure is not shown, and a cashtag stays', () => {
  const tile = withoutShells({ type: 'tile', label: 'Members', value: 'Free', sub: 'Membership starts at $...' });
  assert.deepEqual(tile, { type: 'tile', label: 'Members', value: 'Free', sub: undefined });
  const text = withoutShells({ type: 'text', text: 'Members get in free [2]. Membership starts at $… per year.' });
  assert.equal(text?.type === 'text' ? text.text : '', 'Members get in free [2].');
  const cashtag: CardNode = { type: 'text', text: '$RDW fell 5% today.' };
  assert.equal(withoutShells(cashtag), cashtag);
});

test('a row with a hole goes when two whole rows remain', () => {
  const table = withoutShells({ type: 'table', columns: ['', 'Roth IRA', 'Traditional IRA'], rows: [['2026 limit', '$7,500', ''], ['Taxed', 'No', 'Yes'], ['Deduction', 'No', 'Maybe']] });
  assert.deepEqual(table?.type === 'table' ? table.rows : [], [['Taxed', 'No', 'Yes'], ['Deduction', 'No', 'Maybe']]);
});
