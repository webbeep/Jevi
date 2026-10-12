import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import {
  DIAGRAM_SANDBOX,
  acceptDiagram,
  diagramNeedsRetry,
  diagramDocument,
  diagramIntent,
  diagramRegionIndex,
  diagramSlotAt,
  diagramsEnabled,
  dropModelDiagram,
  layoutWithDiagram,
  readDiagram,
  toMermaid,
  type DiagramKind,
} from '../shared/diagram.ts';
import { sanitizeNodes } from '../server/sanitize.ts';

const POSITIVE: [string, DiagramKind][] = [
  ['diagram how a bill becomes a law', 'flow'],
  ['flowchart of how HTTPS works', 'flow'],
  ['visualize the water cycle', 'flow'],
  ['show a diagram of the Krebs cycle', 'flow'],
  ['explain how the water cycle works', 'flow'],
  ['diagram the process of DNA replication', 'flow'],
  ['visualize how an LLM turns text into the next word', 'concept'],
  ['explain how photosynthesis works', 'concept'],
  ['how does a transformer work', 'concept'],
  ['explain how attention works in a language model', 'concept'],
  ['how do mRNA vaccines work', 'concept'],
  ['diagram of the human heart', 'concept'],
  ['visualize how a compiler works', 'concept'],
  ['schematic of a neuron', 'concept'],
  ['how does the internet work', 'concept'],
  ['visualize how population growth works', 'concept'],
  ['diagram TCP vs UDP', 'concept'],
];

const NEGATIVE = [
  'how to tie a tie',
  'explain how to make sourdough starter',
  'how to get a red wine stain out of a carpet',
  'what is photosynthesis',
  'explain photosynthesis',
  'how tall is the Eiffel Tower',
  'how many people live in Tokyo',
  'how much does an iPhone cost',
  'how long does apple pie keep',
  'visualize the population of countries',
  'chart the highest scoring teams',
  'draw a picture of a cat',
  'iphone 17 vs pixel 10',
  'explain the difference between TCP and UDP',
  'explain how TCP and UDP differ',
  'why is tesla stock dropping',
  'best wireless earbuds under $100',
  'photos of the grand canyon',
  'write an email to my landlord',
  'how old is the president',
  'python read a json file',
  'symptoms of vitamin D deficiency',
  'nba scores tonight',
];

test('diagram intent benchmark keeps precision and recall at 1 on the labeled set', () => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const [question, kind] of POSITIVE) {
    const got = diagramIntent(question);
    if (got === kind) tp++;
    else fn++;
  }
  for (const question of NEGATIVE) {
    if (diagramIntent(question) === null) tn++;
    else fp++;
  }
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  console.log(JSON.stringify({ positive: POSITIVE.length, negative: NEGATIVE.length, tp, fp, fn, tn, precision, recall }));
  assert.equal(fp, 0);
  assert.equal(fn, 0);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test('diagrams stay off until ZO_DIAGRAMS is explicitly on', () => {
  assert.equal(diagramsEnabled(undefined), false);
  assert.equal(diagramsEnabled(''), false);
  assert.equal(diagramsEnabled('0'), false);
  assert.equal(diagramsEnabled('false'), false);
  assert.equal(diagramsEnabled('no'), false);
  assert.equal(diagramsEnabled('1'), true);
  assert.equal(diagramsEnabled('true'), true);
  assert.equal(diagramsEnabled(' yes '), true);
});

const CORPUS = 'Photosynthesis uses light, chlorophyll, water, and carbon dioxide to make sugar. The light reactions happen in the chloroplast.';

const LLM = 'The decoder generates the output text one token at a time. The attention mechanism focuses on specific parts of the input text. Introduction Training Key Innovation Architecture Limitations Applications.';

test('article sections are not a diagram of how something works', () => {
  const toc = acceptDiagram({
    type: 'diagram',
    title: 'Large Language Models',
    nodes: [
      { id: 'a', label: 'Introduction', detail: 'Large language models are a type of artificial intelligence designed to understand and generate human-like text.' },
      { id: 'b', label: 'Training' },
      { id: 'c', label: 'Key Innovation' },
      { id: 'd', label: 'Architecture' },
      { id: 'e', label: 'Limitations' },
      { id: 'f', label: 'Applications' },
    ],
  }, LLM, 'concept');
  assert.equal(toc, undefined);
  const card = acceptDiagram({
    nodes: [
      { id: 'a', label: 'Token', detail: 'The decoder generates the output text one token at a time.' },
      { id: 'b', label: 'Attention', detail: 'The attention mechanism focuses on specific parts of the input text.' },
      { id: 'c', label: 'Decoder', detail: 'The decoder generates the output text one token at a time.' },
    ],
  }, LLM, 'concept');
  assert.ok(card);
  assert.deepEqual(card.nodes.map((n) => n.label), ['Token', 'Attention', 'Decoder']);
  assert.match(card.nodes[0]?.detail ?? '', /token/);
  const graphic = diagramDocument(card, true);
  assert.match(graphic, /<svg/);
  assert.match(graphic, /class="arrow"/);
  assert.match(graphic, /marker-end="url\(#arrowhead\)"/);
  assert.equal(graphic.includes('<button'), false);
  assert.equal(diagramNeedsRetry({
    nodes: [
      { label: 'Introduction' },
      { label: 'Training' },
      { label: 'Architecture' },
    ],
  }, undefined), true);
  assert.equal(diagramNeedsRetry({ nodes: [] }, undefined), false);
  assert.equal(diagramNeedsRetry({ nodes: [{ label: 'Token' }, { label: 'Attention' }, { label: 'Decoder' }] }, card), false);
});

test('a diagram keeps source-backed stages and drops an invented one', () => {
  const card = acceptDiagram({
    type: 'diagram',
    kind: 'flow',
    title: 'Photosynthesis',
    nodes: [
      { id: 'a', label: 'Light', detail: 'The light reactions happen in the chloroplast.' },
      { id: 'b', label: 'Chlorophyll' },
      { id: 'c', label: 'Water' },
      { id: 'd', label: 'Sugar' },
      { id: 'e', label: 'Cheese moon' },
    ],
  }, CORPUS, 'concept');
  assert.ok(card);
  assert.equal(card.kind, 'concept');
  assert.deepEqual(card.nodes.map((n) => n.label), ['Light', 'Chlorophyll', 'Water', 'Sugar']);
  assert.equal(card.nodes.some((n) => /cheese/i.test(n.label)), false);
  assert.equal(card.mermaid, undefined);
  assert.deepEqual(card.edges, [
    { from: 'n0', to: 'n1' },
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3' },
  ]);
});

test('a flow compiles Mermaid that quotes every remaining label', () => {
  const card = acceptDiagram({
    nodes: [
      { id: 'a', label: 'House' },
      { id: 'b', label: 'Senate' },
      { id: 'c', label: 'President' },
    ],
  }, 'A bill passes the House, then the Senate, then the President.', 'flow');
  assert.ok(card);
  assert.equal(card.kind, 'flow');
  const mermaid = toMermaid(card);
  assert.equal(card.mermaid, mermaid);
  assert.match(mermaid, /^flowchart TD/);
  for (const label of ['House', 'Senate', 'President']) assert.match(mermaid, new RegExp(`\\["${label}"\\]`));
  assert.equal(mermaid.includes('<'), false);
});

test('fewer than three grounded stages means no diagram', () => {
  assert.equal(acceptDiagram({
    nodes: [
      { id: 'a', label: 'Light' },
      { id: 'b', label: 'Unicorn' },
      { id: 'c', label: 'Dragon' },
    ],
  }, CORPUS, 'concept'), undefined);
  assert.equal(acceptDiagram({ nodes: [] }, CORPUS, 'concept'), undefined);
  assert.equal(acceptDiagram({ nodes: [{ id: 'a', label: 'Light' }] }, '', 'concept'), undefined);
});

test('hostile stages are dropped, and two remaining stages are not a diagram', () => {
  const card = acceptDiagram({
    title: 'Photosynthesis',
    nodes: [
      { id: 'a', label: 'Light' },
      { id: 'b', label: 'Chlorophyll </div><script>alert(1)</script>' },
      { id: 'c', label: 'Water', detail: '<img src=x onerror=alert(1)>' },
      { id: 'd', label: 'Sugar' },
      { id: 'e', label: 'javascript:alert(1)' },
    ],
  }, CORPUS, 'concept');
  assert.equal(card, undefined);
});

test('three safe stages still render when a hostile stage is beside them', () => {
  const card = acceptDiagram({
    nodes: [
      { id: 'a', label: 'Light' },
      { id: 'b', label: '</div><script>alert(1)</script>' },
      { id: 'c', label: 'Chlorophyll' },
      { id: 'd', label: 'Sugar' },
    ],
  }, CORPUS, 'flow');
  assert.ok(card);
  const doc = diagramDocument(card, false);
  assert.equal(doc.includes('alert(1)'), false);
  assert.equal(doc.includes('onerror'), false);
  assert.equal(doc.includes('javascript:'), false);
  assert.match(doc, /data-zo="diagram"/);
  assert.equal(doc.includes('allow-same-origin'), false);
  for (const label of card.nodes.map((n) => n.label)) assert.equal(doc.includes(label), true);
  assert.match(doc, /<pre hidden>flowchart TD/);
});

test('the frame sandbox is scripts only', () => {
  assert.equal(DIAGRAM_SANDBOX, 'allow-scripts');
  assert.equal(DIAGRAM_SANDBOX.includes('allow-same-origin'), false);
});

test('a detail with an unsourced number is left off the stage', () => {
  const card = acceptDiagram({
    nodes: [
      { id: 'a', label: 'Light', detail: 'The light reactions use 400 nanometers.' },
      { id: 'b', label: 'Chlorophyll' },
      { id: 'c', label: 'Sugar' },
    ],
  }, CORPUS, 'concept');
  assert.ok(card);
  assert.equal(card.nodes[0]?.detail, undefined);
});

test('sanitize keeps a stored diagram and drops markup inside it', () => {
  const [node] = sanitizeNodes([{
    type: 'diagram',
    kind: 'flow',
    title: 'Water cycle',
    nodes: [
      { id: 'a', label: 'Evaporation' },
      { id: 'b', label: 'Condensation' },
      { id: 'c', label: '<script>alert(1)</script>' },
      { id: 'd', label: 'Precipitation' },
    ],
  }], 0);
  assert.equal(node?.type, 'diagram');
  if (node?.type !== 'diagram') return;
  assert.deepEqual(node.nodes.map((n) => n.label), ['Evaporation', 'Condensation', 'Precipitation']);
  assert.match(node.mermaid ?? '', /Evaporation/);
});

test('a diagram written by the page designer is removed', () => {
  const section: CardNode = {
    type: 'section',
    title: 'How',
    children: [
      { type: 'text', text: 'Plants make sugar.' },
      { type: 'diagram', kind: 'concept', nodes: [{ id: 'n0', label: 'Light' }, { id: 'n1', label: 'Water' }, { id: 'n2', label: 'Sugar' }], edges: [] },
    ],
  };
  const kept = dropModelDiagram(section);
  assert.equal(kept?.type, 'section');
  if (kept?.type !== 'section') return;
  assert.deepEqual(kept.children.map((c) => c.type), ['text']);
});

test('the diagram hole sits after the opening answer and shifts later regions', () => {
  const hero: CardNode = { type: 'slot', hint: 'answer', shape: 'hero' };
  const block: CardNode = { type: 'slot', hint: 'parts', shape: 'block' };
  const layout = layoutWithDiagram([hero, block], false);
  assert.equal(layout.length, 3);
  assert.equal(layout[1]?.type, 'slot');
  if (layout[1]?.type === 'slot') assert.equal(layout[1].hint, 'How it fits together');
  assert.equal(diagramRegionIndex(0, false, true), 0);
  assert.equal(diagramRegionIndex(1, false, true), 2);
  assert.equal(diagramSlotAt(false, 2), 1);
  assert.equal(diagramRegionIndex(0, true, true), 1);
  assert.equal(diagramRegionIndex(1, true, true), 3);
  assert.equal(diagramSlotAt(true, 2), 2);
  assert.equal(diagramRegionIndex(1, false, false), 1);
});

test('readDiagram refuses a diagram that markup hollowed out', () => {
  assert.equal(readDiagram({
    kind: 'concept',
    nodes: [
      { label: '<script>a</script>' },
      { label: '<script>b</script>' },
      { label: '<script>c</script>' },
    ],
  }), undefined);
});
