import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { fitNode, undupeParen } from '../shared/fitChart.ts';
import { heuristicPattern } from '../server/patterns.ts';

const chart = (over: Partial<Extract<CardNode, { type: 'chart' }>>): Extract<CardNode, { type: 'chart' }> => ({
  type: 'chart',
  kind: 'bar',
  data: [],
  ...over,
});

function tableRows(node: CardNode): string[][] {
  if (node.type === 'table') return node.rows;
  if (node.type === 'section') {
    const inner = node.children.find((child) => child.type === 'table');
    return inner?.type === 'table' ? inner.rows : [];
  }
  return [];
}

test('component benchmark: the layout matches what the question is asking to see', () => {
  const cases: [string, string][] = [
    ['nba scores today', 'briefing'],
    ['nba game highlights yesterday', 'briefing'],
    ['nba tip-off times tonight', 'briefing'],
    ['lakers score', 'spotlight'],
    ['population by country', 'dataset'],
    ['who is chris lung', 'profile'],
    ['renting vs buying a home', 'compare'],
    ['how to tie a tie', 'steps'],
    ['AAPL price', 'spotlight'],
    ['write an email to my landlord', 'draft'],
  ];
  for (const [query, pattern] of cases) assert.equal(heuristicPattern(query), pattern, query);
});

test('a tip-off chart becomes a table of clock times, and the timezone is not repeated', () => {
  const node = fitNode(chart({
    title: 'Oct 10, 2026 Preseason Tip-Off Times (ET) (ET)',
    unit: 'ET',
    data: [
      { label: 'ATL @', value: 19 },
      { label: 'DET @', value: 19.5 },
      { label: 'PHI', value: 20 },
    ],
  }), 'nba scores today');
  assert.equal(node.type, 'section');
  if (node.type !== 'section') return;
  assert.equal(node.title, 'Oct 10, 2026 Preseason Tip-Off Times');
  assert.equal(undupeParen('Oct 10, 2026 Preseason Tip-Off Times (ET) (ET)'), 'Oct 10, 2026 Preseason Tip-Off Times (ET)');
  const table = node.children[0];
  assert.equal(table?.type, 'table');
  if (table?.type !== 'table') return;
  assert.deepEqual(table.columns, ['Game', 'Time (ET)']);
  assert.deepEqual(table.rows, [
    ['ATL @', '7:00 PM'],
    ['DET @', '7:30 PM'],
    ['PHI', '8:00 PM'],
  ]);
});

test('a slate of scores keeps the full team names in a table', () => {
  const node = fitNode(chart({
    title: "Yesterday's NBA Preseason Scores (points)",
    unit: 'points',
    data: [
      { label: 'Bucks', value: 118 },
      { label: 'Bulls', value: 112 },
      { label: 'Trail Blazers', value: 104 },
      { label: 'Magic', value: 121 },
      { label: 'Nuggets', value: 115 },
    ],
  }), 'nba game highlights yesterday');
  assert.deepEqual(tableRows(node).map((row) => row[0]), ['Bucks', 'Bulls', 'Trail Blazers', 'Magic', 'Nuggets']);
  assert.equal(node.type === 'section' ? node.children[0]?.type : node.type, 'table');
});

test('a ranking of one magnitude stays a chart, and long names turn sideways', () => {
  const countries = fitNode(chart({
    title: 'Population',
    unit: 'people',
    data: [
      { label: 'India', value: 1400 },
      { label: 'China', value: 1410 },
      { label: 'United States', value: 330 },
    ],
  }), 'population by country');
  assert.equal(countries.type, 'chart');
  if (countries.type === 'chart') assert.equal(countries.kind, 'hbar');

  const short = fitNode(chart({
    title: 'Medal count',
    data: [
      { label: 'USA', value: 40 },
      { label: 'CHN', value: 38 },
      { label: 'GBR', value: 22 },
    ],
  }), 'olympic medal ranking');
  assert.equal(short.type, 'chart');
  if (short.type === 'chart') assert.equal(short.kind, 'bar');
});

test('a scoring trend stays a line, and an asked-for chart stays a chart', () => {
  const line = fitNode(chart({
    kind: 'line',
    title: 'Points per game',
    data: [
      { label: 'Oct 1', value: 108 },
      { label: 'Oct 4', value: 121 },
      { label: 'Oct 8', value: 99 },
    ],
  }), 'nba scores this month');
  assert.equal(line.type, 'chart');
  if (line.type === 'chart') assert.equal(line.kind, 'line');

  const asked = fitNode(chart({
    title: 'Points',
    data: [
      { label: 'Bucks', value: 118 },
      { label: 'Bulls', value: 112 },
      { label: 'Magic', value: 121 },
    ],
  }), 'chart the highest scoring teams');
  assert.equal(asked.type, 'chart');
});
