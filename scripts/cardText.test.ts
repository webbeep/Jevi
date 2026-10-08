import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnswerCard } from '../shared/card';
import { cardPlainText } from '../shared/cardText.ts';

test('plain text of a card keeps its blocks and drops markdown and markers', () => {
  const card: AnswerCard = {
    title: 'Mount Everest',
    subtitle: 'The basics',
    body: [
      { type: 'hero', value: '8849', unit: 'm', label: 'Height', caption: 'Measured in 2020 [1]' },
      { type: 'text', text: '**Everest** is the highest mountain on Earth [1].' },
      { type: 'stat', label: 'First ascent', value: '1953', delta: '+1 yr' },
      { type: 'list', style: 'number', items: [{ text: 'South col route' }, { text: 'North ridge', meta: 'harder' }] },
    ],
  };
  assert.equal(
    cardPlainText(card),
    [
      'Mount Everest',
      'The basics',
      '',
      'Height: 8849 m',
      'Measured in 2020',
      '',
      'Everest is the highest mountain on Earth.',
      '',
      'First ascent: 1953 (+1 yr)',
      '',
      '1. South col route',
      '2. North ridge (harder)',
    ].join('\n'),
  );
  assert.ok(!cardPlainText(card).includes('**'));
  assert.ok(!cardPlainText(card).includes('[1]'));
});

test('links use result titles and never expose URLs', () => {
  const card: AnswerCard = {
    title: 'Sources',
    body: [{ type: 'links', items: [{ source: 1 }, { source: 2, label: 'Custom label' }, { source: 9 }] }],
  };
  const text = cardPlainText(card, [{ title: 'Everest — Wikipedia' }, { title: 'Nepal tourism board' }]);
  assert.equal(text, ['Sources', '', '- Everest — Wikipedia', '- Custom label'].join('\n'));
  assert.ok(!/https?:/.test(text));
});

test('nested layout nodes keep their text in order', () => {
  const card: AnswerCard = {
    title: 'Nested',
    body: [
      { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Country', value: 'Nepal' }] },
      { type: 'section', title: 'Details', children: [{ type: 'quote', text: 'High', source: 'A climber' }] },
      { type: 'tabs', tabs: [{ label: 'Routes', children: [{ type: 'badges', items: ['South', 'North'] }] }, { label: 'Empty', children: [] }] },
    ],
  };
  const text = cardPlainText(card);
  assert.ok(text.includes('Country: Nepal'));
  assert.ok(text.includes('Details'));
  assert.ok(text.includes('"High" — A climber'));
  assert.ok(text.includes('Routes'));
  assert.ok(text.includes('South, North'));
  assert.equal(text.indexOf('Country: Nepal') < text.indexOf('Details'), true);
  assert.equal(text.indexOf('Details') < text.indexOf('Routes'), true);
});

test('placeholders and buttons add no text', () => {
  const card: AnswerCard = {
    title: 'Placeholders',
    body: [
      { type: 'slot', hint: 'chart', shape: 'chart' },
      { type: 'actions', items: [{ label: 'Search more', query: 'everest' }] },
      { type: 'gallery', refs: [1, 2] },
      { type: 'citations', refs: [1] },
      { type: 'divider' },
    ],
  };
  assert.equal(cardPlainText(card), 'Placeholders');
});
