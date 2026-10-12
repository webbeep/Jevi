#!/usr/bin/env node
/**
 * Live accuracy check for diagram cards. Hits an experiment preview, never production.
 *
 *   node --experimental-strip-types --import ./scripts/register-hook.mjs scripts/diagram-live.mjs https://experiment.zo2.pages.dev
 *
 * A signed-out run spends real search and model calls (the answer cache is bypassed).
 * Pass: every control question has no diagram, and at least 2 of the 3 diagram
 * questions come back as the right kind, with every label in the graphic and at
 * least one of its words in the question, the snippets, or the rest of the card.
 */
import { writeFileSync } from 'node:fs';
import { acceptDiagram, diagramDocument, diagramIntent } from '../shared/diagram.ts';

const base = (process.argv.find((a) => /^https?:/.test(a)) ?? '').replace(/\/$/, '');
const outAt = process.argv.indexOf('--out');
const out = outAt >= 0 ? process.argv[outAt + 1] : '';

if (!base) {
  console.error('Pass the experiment preview URL. Refusing to guess a host.');
  process.exit(2);
}
const host = new URL(base).hostname;
if (host === 'zo.fyi' || host === 'www.zo.fyi' || host === 'zo2.pages.dev') {
  console.error(`Refusing ${host}. Diagrams are tried on an experiment preview, not production.`);
  process.exit(2);
}

const CASES = [
  { q: 'explain how photosynthesis works', kind: 'concept', want: true },
  { q: 'diagram how a bill becomes a law', kind: 'flow', want: true },
  { q: 'visualize how an LLM turns text into the next word', kind: 'concept', want: true },
  { q: 'how to tie a tie', kind: null, want: false },
];

function walkText(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'diagram') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && key !== 'type') out.push(value);
    else if (Array.isArray(value)) value.forEach((item) => walkText(item, out));
    else if (value && typeof value === 'object') walkText(value, out);
  }
}

function evidenceOf(row) {
  const bits = [row.q];
  for (const result of row.search?.results ?? []) bits.push(result.title ?? '', result.snippet ?? '');
  if (row.search?.knowledge) bits.push(row.search.knowledge.title ?? '', row.search.knowledge.extract ?? '');
  for (const node of row.card?.body ?? []) walkText(node, bits);
  return bits.filter(Boolean).join(' ');
}

function diagramsOf(card) {
  return (card?.body ?? []).filter((node) => node && node.type === 'diagram');
}

async function ask(q) {
  const res = await fetch(`${base}/api/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zo-refresh': '1' },
    body: JSON.stringify({ kind: 'search', query: q, freshness: 'any' }),
  });
  if (!res.ok || !res.body) return { q, status: res.status, error: await res.text().catch(() => '') };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ev = 'message';
  const nodes = new Map();
  let head;
  let search;
  let error;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        let data;
        try { data = JSON.parse(line.slice(5)); } catch { data = null; }
        if (ev === 'node' && data?.node) nodes.set(data.index, data.node);
        else if (ev === 'head') head = data;
        else if (ev === 'search') search = data;
        else if (ev === 'error') error = data;
      } else if (!line) ev = 'message';
    }
  }
  const body = [...nodes.keys()].sort((a, b) => a - b).map((i) => nodes.get(i));
  return { q, status: res.status, error: error?.message ?? error, search, card: { title: head?.title ?? q, ...head, body } };
}

function score(spec, row) {
  const diagrams = diagramsOf(row.card);
  const intent = diagramIntent(spec.q);
  assertKind(intent, spec.kind);
  if (row.error) return { q: spec.q, pass: false, reason: String(row.error), diagrams: diagrams.length };
  if (!spec.want) {
    const pass = diagrams.length === 0;
    return { q: spec.q, pass, want: false, diagrams: diagrams.length, reason: pass ? 'no diagram' : 'control question drew a diagram' };
  }
  if (diagrams.length !== 1) return { q: spec.q, pass: false, want: true, diagrams: diagrams.length, reason: 'expected one diagram' };
  const node = diagrams[0];
  if (node.kind !== spec.kind) return { q: spec.q, pass: false, want: true, kind: node.kind, reason: `kind ${node.kind}` };
  const doc = diagramDocument(node, false);
  const labels = (node.nodes ?? []).map((n) => n.label);
  const missing = labels.filter((label) => !doc.includes(label));
  const unsafe = /onerror|javascript:|allow-same-origin/i.test(doc) || labels.some((label) => /<|>|javascript:/i.test(label));
  const evidence = evidenceOf(row);
  const grounded = acceptDiagram({ nodes: node.nodes, title: node.title }, evidence, spec.kind);
  const mermaidOk = spec.kind !== 'flow' || labels.every((label) => (node.mermaid ?? '').includes(label));
  const pass = missing.length === 0 && !unsafe && !!grounded && grounded.nodes.length === labels.length && mermaidOk;
  return {
    q: spec.q,
    pass,
    want: true,
    kind: node.kind,
    labels,
    grounded: grounded ? grounded.nodes.map((n) => n.label) : [],
    mermaidOk,
    unsafe,
    reason: pass ? 'grounded diagram' : 'diagram failed the accuracy check',
  };
}

function assertKind(intent, expected) {
  if (intent !== expected) throw new Error(`fixture intent ${intent} !== ${expected}`);
}

const rows = [];
for (const spec of CASES) {
  const row = await ask(spec.q);
  const result = score(spec, row);
  rows.push(result);
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.q}  ${result.reason}`);
}

const controls = rows.filter((row) => row.want === false);
const wanted = rows.filter((row) => row.want === true);
const summary = {
  base,
  at: new Date().toISOString(),
  controlsPassed: controls.filter((row) => row.pass).length,
  controls: controls.length,
  diagramsPassed: wanted.filter((row) => row.pass).length,
  diagrams: wanted.length,
  rows,
};
console.log(JSON.stringify(summary, null, 2));
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));

const ok = controls.every((row) => row.pass) && wanted.filter((row) => row.pass).length >= 2;
process.exit(ok ? 0 : 1);
