import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { Grounding, groundNodes } from '../server/ground.ts';
import { claimSources, retargetCites } from '../server/claims.ts';
import { compareSides } from '../server/patterns.ts';
import { paperOnTopic, trialsFirst, type Work } from '../server/scholarly.ts';
import { valueUnit } from '../server/sanitize.ts';
import { deniesPrice, tickerBody } from '../shared/tickerNotes.ts';

const PAPERS = [
  { title: 'STEP 3 randomized clinical trial', url: 'https://doi.org/10.1001/jama.2021.1831', domain: 'doi.org', snippet: 'Semaglutide vs placebo, 611 adults.', engines: ['web'] },
  { title: 'STEP 4 randomized clinical trial', url: 'https://doi.org/10.1001/jama.2021.3224', domain: 'doi.org', snippet: 'Continued semaglutide, 803 adults.', engines: ['web'] },
];

test('a DOI from the sources is shown whole, and an invented one is not', () => {
  const g = new Grounding(PAPERS.map((p) => `${p.title} ${p.snippet}`).join('\n'), false, PAPERS.map((p) => p.url).join(' '));
  const text = 'STEP 3 (10.1001/jama.2021.1831) enrolled 611 adults. STEP 4 is 10.1001/jama.2021.3224.';
  assert.deepEqual(groundNodes([{ type: 'text', text }], g), [{ type: 'text', text }]);
  assert.deepEqual(groundNodes([{ type: 'text', text: 'STEP 1 is 10.1056/NEJMoa2032183. STEP 3 enrolled 611 adults.' }], g), [{ type: 'text', text: 'STEP 3 enrolled 611 adults.' }]);
  const cited = retargetCites('Trials: 10.1001/jama.2021.1831 and 10.1001/jama.2021.3224 [1]', claimSources(PAPERS, []));
  assert.match(cited, /10\.1001\/jama\.2021\.1831/);
  assert.match(cited, /10\.1001\/jama\.2021\.3224/);
});

test('a trial ask lists trials: reviews and protocols are dropped and PubMed trials lead', () => {
  const ask = 'List three peer-reviewed randomized trials of semaglutide for weight loss, with DOIs.';
  const works: Work[] = [
    { doi: '10.1111/obr.13792', title: 'Semaglutide for weight loss: a systematic review and meta-analysis of randomized controlled trials' },
    { doi: '10.1016/j.cct.2022.106687', title: 'Randomized clinical trials of weight loss: pragmatic and digital strategies' },
    { doi: '10.1056/x', title: 'Oral semaglutide 25 mg in adults with obesity' },
    { doi: '10.1001/jama.2021.1831', title: 'Semaglutide vs placebo: the STEP 3 randomized clinical trial', trial: true },
  ];
  assert.deepEqual(trialsFirst(works, ask).map((w) => w.doi), ['10.1001/jama.2021.1831', '10.1056/x']);
  assert.equal(paperOnTopic(ask, 'Machine learning to optimize precision in the analysis of randomized trials'), false);
  assert.equal(paperOnTopic(ask, 'Effect of semaglutide on weight loss in adults'), true);
});

test('a comparison names its sides, not the question around them', () => {
  assert.deepEqual(compareSides('Compare the iPhone 17 and Pixel 10 side by side: starting price and base storage.'), ['iPhone 17', 'Pixel 10']);
  assert.deepEqual(compareSides('Make a table comparing a Roth IRA and a traditional IRA for 2026: contribution limit, tax treatment, and income limits.'), ['Roth IRA', 'traditional IRA']);
  assert.deepEqual(compareSides('Phones: iPhone 17 vs Pixel 10'), ['iPhone 17', 'Pixel 10']);
  assert.deepEqual(compareSides('What is the tallest building in New York City?'), []);
});

test('a hero unit is never cut, and a degree sign shows once', () => {
  assert.deepEqual(valueUnit('<10%', 'of total energy intake'), { value: '<10%', phrase: 'of total energy intake' });
  assert.deepEqual(valueUnit('60°', '°F'), { value: '60', unit: '°F' });
  assert.deepEqual(valueUnit('150-300', 'min/week'), { value: '150-300', unit: 'min/week' });
});

test('beside the live chart, a line saying no price came back is dropped', () => {
  assert.equal(deniesPrice('Live quote unavailable – no market data found'), true);
  assert.equal(deniesPrice('No current Nvidia price came back from the sources, so the exact live figure can\'t be confirmed here.'), true);
  assert.equal(deniesPrice('Nvidia closed at $214.13 on Friday.'), false);
  const ticker = { type: 'ticker', symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', currency: 'USD', feed: 'Yahoo Finance', series: { range: '1D', points: [[1, 1], [2, 2]], base: 1, price: 2, at: '' } } as unknown as CardNode;
  const body = tickerBody([
    { type: 'hero', value: 'Unavailable', label: 'Live quote unavailable – no market data found' },
    ticker,
    { type: 'text', text: 'No market data source came back for this request, so there is no current Nvidia quote to show. Prices move every second during trading hours.' },
  ]);
  assert.deepEqual(body.map((node) => node.type), ['ticker', 'text']);
  assert.equal((body[1] as Extract<CardNode, { type: 'text' }>).text, 'Prices move every second during trading hours.');
});
