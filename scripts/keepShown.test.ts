import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { keepShownComponent } from '../shared/keepShown.ts';

const table: CardNode = {
  type: 'table',
  columns: ['', 'Points', 'Rebounds'],
  rows: [
    ['Northwatch', '18.4', '10.2'],
    ['Glowband', '12.1', '8.4'],
  ],
};

test('a measured breakdown stays when a different card is sent for that slot', () => {
  const replacement: CardNode = {
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'tile', label: 'Northwatch', value: '$90' },
      { type: 'tile', label: 'Glowband', value: '$40' },
    ],
  };
  assert.equal(keepShownComponent(table, replacement), table);
});

test('a wrap that still contains the breakdown can add photos around it', () => {
  const wrapped: CardNode = {
    type: 'stack',
    gap: 'md',
    children: [
      {
        type: 'grid',
        cols: 2,
        children: [
          { type: 'tile', label: 'Northwatch', value: '$90', imageSrc: 'https://img.example/north.jpg' },
          { type: 'tile', label: 'Glowband', value: '$40', imageSrc: 'https://img.example/glow.jpg' },
        ],
      },
      table,
    ],
  };
  assert.equal(keepShownComponent(table, wrapped), wrapped);
});

test('a same-type edit can change one cell and can add a column', () => {
  const edited: CardNode = {
    ...table,
    rows: [
      ['Northwatch', '18.4', '10.2'],
      ['Glowband', '12.1', '9.0'],
    ],
  };
  assert.equal(keepShownComponent(table, edited), edited);
  const wider: CardNode = {
    type: 'table',
    columns: ['', 'Points', 'Rebounds', 'Assists'],
    rows: [
      ['Northwatch', '18.4', '10.2', '3.1'],
      ['Glowband', '12.1', '8.4', '1.4'],
    ],
  };
  assert.equal(keepShownComponent(table, wider), wider);
});

test('a same-type card that drops a side does not replace the breakdown', () => {
  const dropped: CardNode = {
    type: 'table',
    columns: ['', 'Points', 'Rebounds'],
    rows: [['Northwatch', '18.4', '10.2']],
  };
  assert.equal(keepShownComponent(table, dropped), table);
});

test('a photo update on the tiles already showing still applies', () => {
  const tiles: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch', value: '$90' },
      { type: 'tile', label: 'Glowband', value: '$40' },
    ],
  };
  const photos: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Northwatch', value: '$90', imageSrc: 'https://img.example/north.jpg' },
      { type: 'tile', label: 'Glowband', value: '$40', imageSrc: 'https://img.example/glow.jpg' },
    ],
  };
  assert.equal(keepShownComponent(tiles, photos), photos);
});

test('a component that is not a measured breakdown can still be replaced', () => {
  const text: CardNode = { type: 'text', text: 'Pick either one.', size: 'lg' };
  const next: CardNode = { type: 'tile', label: 'Northwatch', value: '$90' };
  assert.equal(keepShownComponent(text, next), next);
  assert.equal(keepShownComponent(undefined, table), table);
});
