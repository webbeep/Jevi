#!/usr/bin/env node
// Runs a search, then picks each "Which one?" choice the way the app does, and prints the picked cards.
// usage: node scripts/pick-probe.mjs <baseUrl> "<question>" [--pick N] [--json out.json]
// Every ask bypasses the answer cache, so it spends real search and model calls.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://zo.fyi').replace(/\/$/, '');
const question = args.find((a) => !/^https?:/.test(a) && !a.startsWith('--') && !/^\d+$/.test(a) && !/\.json$/.test(a));
const at = args.indexOf('--pick');
const only = at >= 0 ? Number(args[at + 1]) : undefined;
const jat = args.indexOf('--json');
const out = jat >= 0 ? args[jat + 1] : undefined;

async function stream(body) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zo-refresh': '1', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
  const nodes = new Map();
  let head, search, done, ev = 'message', buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        let data;
        try { data = JSON.parse(line.slice(5)); } catch { data = line.slice(5); }
        if (ev === 'node') nodes.set(data.index, data.node);
        else if (ev === 'head') head = data;
        else if (ev === 'search') search = data;
        else if (ev === 'done') done = data;
        else if (ev === 'patch' && data?.card) head = { ...head, ...data.card };
      } else if (!line) ev = 'message';
    }
  }
  const body2 = [...nodes.keys()].sort((a, b) => a - b).map((i) => nodes.get(i));
  return { ms: Math.round(performance.now() - t0), card: { ...head, body: done?.card?.body ?? body2 }, done, search };
}

const images = (card) => JSON.stringify(card).match(/"(?:src|url|image)":"https?:[^"]+\.(?:jpe?g|png|webp)[^"]*"/gi) ?? [];
const types = (node, acc = []) => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => types(n, acc)); return acc; }
  if (typeof node.type === 'string') acc.push(node.type);
  for (const v of Object.values(node)) if (v && typeof v === 'object') types(v, acc);
  return acc;
};

const first = await stream({ kind: 'search', query: question, freshness: 'any' });
const choices = first.done?.choices ?? first.card?.choices?.options ?? [];
console.log(`search ${first.ms}ms "${first.card.title}" choices=${choices.length}`);
for (const c of choices) console.log(`  - ${c.name} | ${c.descriptor ?? ''} | q=${c.query ?? ''}`);
const rows = [];
for (const [i, c] of choices.entries()) {
  if (only !== undefined && only !== i) continue;
  const q = c.query?.trim() || (c.descriptor ? `${c.name} (${c.descriptor})` : c.name);
  const picked = await stream({
    kind: 'followup', question: q, original: question, search: first.search,
    cards: [{ id: 1, title: first.card.title, card: first.card }], context: `Asked: ${question}\nCard: ${first.card.title}`, intent: 'search', from: 1,
  });
  const t = [...new Set(types(picked.card.body))];
  console.log(`\npick ${i} "${q}" ${picked.ms}ms title="${picked.card.title}" pattern=${picked.done?.pattern ?? picked.card.pattern ?? ''}`);
  console.log(`  node types: ${t.join(', ')}`);
  console.log(`  images: ${images(picked.card).join('\n          ')}`);
  console.log(`  text: ${JSON.stringify(picked.card.body).slice(0, 900)}`);
  rows.push({ q, ms: picked.ms, card: picked.card, done: picked.done });
}
if (out) writeFileSync(out, JSON.stringify({ first: { ms: first.ms, card: first.card, done: first.done, results: first.search?.results }, rows }, null, 2));
