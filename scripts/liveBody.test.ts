import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveBody } from '../shared/liveBody.ts';
import type { CardNode } from '../shared/card.ts';

const text = (t: string): CardNode => ({ type: 'text', text: t });
const slot = (hint: string): CardNode => ({ type: 'slot', hint, shape: 'block' });

test('nodes arriving in order show the arrived prefix, and the gap stays empty', () => {
  const regions = [slot('a'), slot('b'), slot('c'), slot('d')];
  const nodes: (CardNode | undefined)[] = [text('0'), text('1')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1')]);
  nodes[2] = text('2');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2')]);
});

test('the Ford order holds everything after the first gap until it fills', () => {
  const regions = [slot('0'), slot('1'), slot('2'), slot('3'), slot('4'), slot('5')];
  const nodes: (CardNode | undefined)[] = [text('0'), undefined, text('2'), text('3'), text('4')];
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0')]);
  nodes[1] = text('1');
  assert.deepEqual(liveBody({ nodes, regions }, true), [text('0'), text('1'), text('2'), text('3'), text('4')]);
});

test('nothing arrived shows nothing: the research trail covers the wait', () => {
  const regions = [slot('a'), slot('b')];
  assert.deepEqual(liveBody({ nodes: [], regions }, true), []);
  assert.deepEqual(liveBody({ nodes: [undefined, undefined], regions }, true), []);
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
