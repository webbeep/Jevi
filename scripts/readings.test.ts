import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { heuristicPattern, patternSkeleton } from '../server/patterns.ts';
import { isBareLocalAsk, queryWithPlace, readerPlace, settleReadings } from '../server/readings.ts';

const weatherBody: CardNode[] = [
  {
    type: 'stack',
    direction: 'row',
    gap: 'md',
    children: [
      { type: 'hero', value: '89', unit: '°F', label: 'Snohomish, WA', caption: 'Partly cloudy · humidity 89% · dew point 43°F', icon: 'cloud-sun' },
      {
        type: 'keyvalue',
        items: [
          { label: 'Pressure', value: '29.91 in' },
          { label: 'Visibility', value: '7 mi' },
          { label: 'Rainfall', value: '0.22 in' },
          { label: 'Snow depth', value: '0 in' },
        ],
      },
    ],
  },
  {
    type: 'scroller',
    children: [
      { type: 'tile', label: 'Now', value: 'Partly cloudy', sub: 'Humidity 89% · Dew point 43°F' },
      { type: 'tile', label: 'Tonight', value: '72°', sub: 'Cloudy' },
      { type: 'slot', hint: 'series', shape: 'tile' },
    ],
  },
  {
    type: 'grid',
    cols: 2,
    gap: 'md',
    children: [
      { type: 'tile', label: 'Pressure', value: '29.91', sub: 'Visibility 7 miles' },
      { type: 'tile', label: 'Humidity', value: '89' },
      { type: 'tile', label: 'Visibility', value: '7' },
      { type: 'tile', label: 'Dew point', value: '43' },
    ],
  },
  {
    type: 'choices',
    label: 'Forecast range',
    options: [
      { label: 'Today', prompt: 'weather today' },
      { label: '10-day', prompt: '10 day forecast' },
      { label: 'Weekend', prompt: 'weekend forecast' },
    ],
  },
];

test('a weather card keeps one copy of each reading and titles the place', () => {
  const settled = settleReadings(weatherBody, { title: 'Weather', subtitle: 'Snohomish, WA' }, 'weather');
  assert.equal(settled.head?.title, 'Snohomish, WA');
  assert.equal(settled.head?.subtitle, undefined);
  const row = settled.nodes[0];
  assert.equal(row?.type, 'stack');
  if (row?.type !== 'stack') return;
  const hero = row.children[0];
  assert.equal(hero?.type, 'hero');
  if (hero?.type === 'hero') assert.equal(hero.label, undefined);
  const list = row.children[1];
  assert.equal(list?.type, 'keyvalue');
  if (list?.type === 'keyvalue') assert.deepEqual(list.items.map((item) => item.label), ['Pressure', 'Visibility', 'Rainfall', 'Snow depth']);
  const series = settled.nodes[1];
  assert.equal(series?.type, 'scroller');
  if (series?.type === 'scroller') {
    assert.equal(series.children.length, 1);
    assert.equal(series.children[0]?.type, 'tile');
    if (series.children[0]?.type === 'tile') assert.equal(series.children[0].label, 'Tonight');
  }
  assert.equal(settled.nodes[2], undefined);
  assert.equal(settled.nodes[3]?.type, 'choices');
  const flat = JSON.stringify(settled.nodes);
  assert.equal(flat.match(/29\.91/g)?.length, 1);
  assert.equal(flat.match(/Humidity|humidity/g)?.length, 1);
  assert.equal(flat.match(/Dew point|dew point/g)?.length, 1);
  assert.equal(flat.match(/Visibility|visibility/g)?.length, 1);
});

test('a price hero and its chart both stay', () => {
  const nodes: CardNode[] = [
    { type: 'hero', value: '412.80', unit: '$', label: 'Tesla', caption: 'Up 1.2% today' },
    { type: 'chart', kind: 'line', data: [{ label: 'Mon', value: 410 }, { label: 'Tue', value: 412.8 }, { label: 'Wed', value: 415 }] },
    { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Day range', value: '405–415' }, { type: 'tile', label: '52-week', value: '180–420' }] },
    { type: 'stat', label: 'Price', value: '412.80', unit: '$' },
  ];
  const settled = settleReadings(nodes, { title: 'Tesla' }, 'AAPL price');
  assert.equal(settled.head, undefined);
  assert.equal(settled.nodes[0]?.type, 'hero');
  assert.equal(settled.nodes[1]?.type, 'chart');
  assert.equal(settled.nodes[2]?.type, 'grid');
  if (settled.nodes[2]?.type === 'grid') assert.equal(settled.nodes[2].children.length, 2);
  assert.equal(settled.nodes[3], undefined);
});

test('a bare weather ask uses the reader city, and a named city is left alone', () => {
  assert.equal(readerPlace({ city: 'Austin', regionCode: 'tx', region: 'Texas' }), 'Austin, TX');
  assert.equal(readerPlace({ city: '' }), undefined);
  assert.equal(readerPlace({ city: 'XX', regionCode: 'WA' }), undefined);
  assert.equal(readerPlace(undefined), undefined);
  assert.equal(isBareLocalAsk('weather'), true);
  assert.equal(isBareLocalAsk("what's the weather today?"), true);
  assert.equal(isBareLocalAsk('7 day forecast'), true);
  assert.equal(isBareLocalAsk('weather in Seattle'), false);
  assert.equal(isBareLocalAsk('Seattle weather'), false);
  assert.equal(queryWithPlace('weather', 'Austin, TX'), 'weather in Austin, TX');
  assert.equal(queryWithPlace("What's the weather today?", 'Austin, TX'), "What's the weather today in Austin, TX");
  assert.equal(queryWithPlace('weather in Seattle', 'Austin, TX'), 'weather in Seattle');
  assert.equal(queryWithPlace('Seattle weather', 'Austin, TX'), 'Seattle weather');
  assert.equal(queryWithPlace('weather', undefined), 'weather');
  assert.equal(queryWithPlace('how do mRNA vaccines work', 'Austin, TX'), 'how do mRNA vaccines work');
});

test('weather uses a single-reading skeleton; a price spotlight does not', () => {
  const weather = patternSkeleton('spotlight', 'weather');
  assert.equal(weather[0]?.type, 'slot');
  if (weather[0]?.type === 'slot') assert.equal(weather[0].shape, 'hero');
  assert.equal(weather[1]?.type, 'scroller');
  assert.equal(weather.some((node) => node.type === 'stack'), false);
  const price = patternSkeleton('spotlight', 'AAPL price');
  assert.equal(price[0]?.type, 'stack');
  assert.equal(heuristicPattern('weather'), 'spotlight');
  assert.equal(heuristicPattern('7 day forecast'), 'spotlight');
  assert.equal(heuristicPattern("what's the weather in Seattle"), 'spotlight');
  assert.equal(heuristicPattern('how does weather work'), 'explainer');
  assert.equal(heuristicPattern('AAPL price'), 'spotlight');
  assert.equal(heuristicPattern('lakers score'), 'spotlight');
});
