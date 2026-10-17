import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveBody } from '../shared/liveBody.ts';
import type { CardNode } from '../shared/card.ts';

const text = (t: string): CardNode => ({ type: 'text', text: t });
const slot = (hint: string): CardNode => ({ type: 'slot', hint, shape: 'block' });
const citations = (refs: number[]): CardNode => ({ type: 'citations', refs });

test('an arrived sentence drops skeletons for slots that do not have their component yet', () => {
  const regions = [slot('a'), slot('b'), slot('c'), slot('d')];
  const nodes: (CardNode | undefined)[] = [text('0'), text('1')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1')]);
  nodes[2] = text('2');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2')]);
});

test('a later region shows immediately and an empty hole is not left as a skeleton', () => {
  const regions = [slot('0'), slot('1'), slot('2'), slot('3'), slot('4'), slot('5')];
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2'), text('3'), text('4')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('2'), text('3'), text('4')]);
  nodes[1] = text('1');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2'), text('3'), text('4')]);
});

test('nothing arrived shows nothing: the research trail covers the wait', () => {
  const regions = [slot('a'), slot('b')];
  assert.deepEqual(liveBody({ nodes: [], regions }, true), []);
  assert.deepEqual(liveBody({ nodes: [undefined, undefined], regions }, true), []);
});

test('citations alone do not start the answer', () => {
  const regions = [slot('a'), slot('b')];
  const nodes: (CardNode | undefined)[] = [undefined, undefined, citations([1])];
  assert.deepEqual(liveBody({ nodes, regions }, true), []);
});

test('once designing is over every arrived node shows, gaps dropped, no skeletons', () => {
  const regions = [slot('0'), slot('1'), slot('2')];
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2')];
  assert.deepEqual(liveBody({ nodes, regions }, false), [text('0'), text('2')]);
  assert.deepEqual(liveBody({ nodes: [], regions }, false), []);
});

test('a gap past the layout holds the later nodes', () => {
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2')];
  assert.deepEqual(liveBody({ nodes, regions: [slot('0')] }, true), [text('0')]);
  assert.deepEqual(liveBody({ nodes, regions: [] }, true), [text('0')]);
});

test('actions after the layout show once the finish prefix is contiguous, and a hole holds citations', () => {
  const regions = [slot('a'), slot('b')];
  const actions: CardNode = { type: 'actions', items: [{ label: 'Compare', query: 'Compare them', kind: 'refine' }] };
  const held: (CardNode | undefined)[] = [text('lead'), undefined, undefined, actions, citations([1])];
  assert.deepEqual(liveBody({ nodes: held, regions }, true), [text('lead')]);
  const ready: (CardNode | undefined)[] = [text('lead'), text('rest'), actions, citations([1])];
  assert.deepEqual(liveBody({ nodes: ready, regions }, true), [text('lead'), text('rest'), actions, citations([1])]);
});

test('a collapsed region is dropped and does not bring its skeleton back', () => {
  const regions = [slot('hero'), slot('series'), slot('details')];
  const blank: CardNode = { type: 'stack', children: [] };
  const nodes: (CardNode | undefined)[] = [text('89°'), blank, blank];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('89°')]);
  assert.deepEqual(liveBody({ nodes, regions }, false), [text('89°')]);
});

test('every node arrived while designing shows them all, no skeleton', () => {
  const regions = [slot('0'), slot('1'), slot('2')];
  const nodes: (CardNode | undefined)[] = [text('0'), text('1'), text('2')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2')]);
  assert.deepEqual(liveBody({ nodes, regions: [] }, true), [text('0'), text('1'), text('2')]);
});
