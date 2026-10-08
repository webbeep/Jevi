import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveBody } from '../shared/liveBody.ts';
import type { CardNode } from '../shared/card.ts';

const text = (t: string): CardNode => ({ type: 'text', text: t });
const slot = (hint: string): CardNode => ({ type: 'slot', hint, shape: 'block' });

test('nodes arriving in order show the arrived prefix, then the one skeleton at the gap', () => {
  const regions = [slot('a'), slot('b'), slot('c'), slot('d')];
  const nodes: (CardNode | undefined)[] = [text('0'), text('1')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), slot('c')]);
  nodes[2] = text('2');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2'), slot('d')]);
});

test('the Ford order holds everything after the first gap until it fills', () => {
  const regions = [slot('0'), slot('1'), slot('2'), slot('3'), slot('4'), slot('5')];
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2'), text('3'), text('4')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), slot('1')]);
  nodes[1] = text('1');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2'), text('3'), text('4'), slot('5')]);
});

test('nothing arrived shows the first skeleton only', () => {
  const regions = [slot('a'), slot('b')];
  assert.deepEqual(liveBody({ nodes: [], regions }, true), [slot('a')]);
  assert.deepEqual(liveBody({ nodes: [undefined, undefined], regions }, true), [slot('a')]);
});

test('once designing is over every arrived node shows, gaps dropped, no skeletons', () => {
  const regions = [slot('0'), slot('1'), slot('2')];
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2')];
  assert.deepEqual(liveBody({ nodes, regions }, false), [text('0'), text('2')]);
  assert.deepEqual(liveBody({ nodes: [], regions }, false), []);
});

test('a gap with no skeleton past the regions list holds the later nodes', () => {
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2')];
  assert.deepEqual(liveBody({ nodes, regions: [slot('0')] }, true), [text('0')]);
  assert.deepEqual(liveBody({ nodes, regions: [] }, true), [text('0')]);
});

test('every node arrived while designing shows them all, no skeleton', () => {
  const regions = [slot('0'), slot('1'), slot('2')];
  const nodes: (CardNode | undefined)[] = [text('0'), text('1'), text('2')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2')]);
  assert.deepEqual(liveBody({ nodes, regions: [] }, true), [text('0'), text('1'), text('2')]);
});
