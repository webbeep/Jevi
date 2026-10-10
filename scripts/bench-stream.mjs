#!/usr/bin/env node
// Live latency + quality benchmark for /api/stream.
// usage: node scripts/bench-stream.mjs [baseUrl] [--out file.json] [--only substr] [--concurrency 2] [--cached]
// Every ask bypasses the answer cache (x-zo-refresh: 1) unless --cached is given, so each run spends real
// search and model calls: keep the query list short.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://zo2.pages.dev').replace(/\/$/, '');
const out = flag('--out');
const only = flag('--only');
const concurrency = Number(flag('--concurrency', '2'));
const cached = args.includes('--cached');

export const QUERIES = [
  { q: 'Btc Usd', kind: 'quote' },
  { q: 'tesla stock price', kind: 'quote' },
  { q: 'AAPL stock', kind: 'quote' },
  { q: 'AI news today', kind: 'news' },
  { q: 'NBA scores tonight', kind: 'news' },
  { q: 'Lebron preseason debut', kind: 'news' },
  { q: 'what happened in the NBA Top 10 Plays on October 7 2026', kind: 'news' },
  { q: 'who is Ed Chu', kind: 'person' },
  { q: 'who is Marie Curie', kind: 'person' },
  { q: 'how do mRNA vaccines work', kind: 'explain' },
  { q: 'what is RAG in AI', kind: 'explain' },
  { q: 'symptoms of vitamin D deficiency', kind: 'explain' },
  { q: 'iphone 17 vs pixel 10', kind: 'compare' },
  { q: 'is renting or buying a home cheaper in 2026', kind: 'compare' },
  { q: 'how to make sourdough starter', kind: 'howto' },
  { q: 'python read a json file', kind: 'howto' },
  { q: 'why $rdw dropping', kind: 'news' },
  { q: 'best budget noise cancelling headphones 2026', kind: 'ranked' },
  { q: 'best coffee shops in Seattle', kind: 'ranked' },
  { q: 'write a short apology email for missing a meeting', kind: 'made' },
  { q: 'draft a short text asking to reschedule dinner', kind: 'made' },
];

export const FOLLOWUPS = [
  { seed: 'how do mRNA vaccines work', q: 'explain it like I am 10', kind: 'chat' },
  { seed: 'iphone 17 vs pixel 10', q: 'which one has better battery life?', kind: 'chat' },
  { seed: 'AI news today', q: 'what about Google?', kind: 'chat' },
  { seed: 'how to make sourdough starter', q: 'can I use rye flour instead?', kind: 'chat' },
  { seed: 'Btc Usd', q: 'why is it moving today?', kind: 'chat' },
  { seed: 'best budget noise cancelling headphones 2026', q: 'which is lightest for travel?', kind: 'chat' },
  { seed: 'NBA scores tonight', q: 'who scored the most?', kind: 'chat' },
  { seed: 'write a short apology email for missing a meeting', q: 'make it shorter', kind: 'chat' },
];

async function run({ q, kind, body }) {
  const t0 = performance.now();
  const at = {};
  const nodes = new Map();
  let repeats = 0;
  let warning = false;
  let search;
  let done;
  let error;
  let head;
  const res = await fetch(`${base}/api/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cached ? {} : { 'x-zo-refresh': '1' }) },
    body: JSON.stringify(body ?? { kind: 'search', query: q, freshness: 'any' }),
  });
  at.ttfb = performance.now() - t0;
  if (!res.ok || !res.body) return { q, kind, status: res.status, error: await res.text().catch(() => '') };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ev = 'message';
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        const ms = performance.now() - t0;
        at[ev] ??= ms;
        let data;
        try { data = JSON.parse(line.slice(5)); } catch { data = line.slice(5); }
        if (ev === 'node') {
          if (nodes.has(data.index)) repeats++;
          nodes.set(data.index, data.node);
          if (JSON.stringify(data.node).includes('triangle-alert')) warning = true;
        } else if (ev === 'search') search = data;
        else if (ev === 'head') head = data;
        else if (ev === 'done') done = data;
        else if (ev === 'error') error = data;
      } else if (!line) ev = 'message';
    }
  }
  const total = performance.now() - t0;
  const r = (n) => (n === undefined ? undefined : Math.round(n));
  return {
    q,
    kind,
    ttfb: r(at.ttfb),
    plan: r(at.plan),
    search: r(at.search),
    designing: r(at.designing),
    head: r(at.head),
    firstNode: r(at.node),
    done: r(at.done),
    total: r(total),
    nodes: nodes.size,
    repeats,
    warning,
    title: head?.title,
    sources: search?.results?.length ?? 0,
    engines: (search?.engines ?? []).map((e) => `${e.name}${e.ok ? '' : `:${e.error ?? 'x'}`}`).join(' '),
    pagesRead: done?.pagesRead,
    engine: done?.engine,
    choices: done?.choices?.length,
    error: error?.message ?? error,
    t: done?.t,
    card: { title: head?.title ?? q, ...head, body: [...nodes.keys()].sort((a, b) => a - b).map((i) => nodes.get(i)) },
    searchData: search,
  };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]).catch((e) => ({ q: items[i].q, error: String(e) }));
      const x = results[i];
      console.error(`${String(x.done ?? x.total ?? '-').padStart(6)}ms  ${x.q}  [${x.engines ?? ''}] nodes=${x.nodes ?? 0} repeats=${x.repeats ?? 0}${x.warning ? ' WARN' : ''}${x.error ? ` ERR ${x.error}` : ''}`);
    }
  }));
  return results;
}

/** The seed search, then the follow-up asked about its card, the way the app sends it. */
async function runFollowup({ seed, q, kind }) {
  const first = await run({ q: seed });
  if (!first.searchData) return { ...first, q: `${seed} → ${q}`, error: 'seed failed' };
  const body = { kind: 'followup', question: q, original: seed, search: first.searchData, cards: [{ id: 1, title: first.card.title, card: first.card }], context: `Asked: ${seed}\nCard: ${first.card.title}` };
  return { ...(await run({ q: `${seed} → ${q}`, kind, body })), seedDone: first.done };
}

const followups = args.includes('--followups');
const list = followups ? FOLLOWUPS : QUERIES;
const pick = only ? list.filter((x) => x.q.toLowerCase().includes(only.toLowerCase())) : list;
const rows = await pool(pick, concurrency, followups ? runFollowup : run);
const pct = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : undefined;
};
const col = (k) => rows.map((x) => x[k]);
const summary = {};
for (const k of ['search', 'designing', 'head', 'firstNode', 'done']) {
  summary[k] = { p50: pct(col(k), 50), p90: pct(col(k), 90), p95: pct(col(k), 95) };
}
const warned = rows.filter((x) => x.warning).length;
const empty = rows.filter((x) => !x.nodes && !x.choices && !x.error).length;
const withSources = rows.filter((x) => typeof x.sources === 'number');
summary.quality = {
  n: rows.length,
  warned,
  empty,
  errors: rows.filter((x) => x.error).length,
  meanSources: withSources.length ? Math.round(withSources.reduce((a, x) => a + x.sources, 0) / withSources.length) : 0,
  meanRepeats: Math.round(rows.reduce((a, x) => a + (x.repeats ?? 0), 0) / Math.max(1, rows.length) * 10) / 10,
};
console.table(rows.map(({ q, search, designing, head, firstNode, done, nodes, repeats, warning, sources, choices }) => ({ q: q.slice(0, 34), search, designing, head, firstNode, done, nodes, repeats, warning, sources, choices })));
console.log(JSON.stringify(summary));
const stages = rows.filter((x) => x.t).map((x) => ({ q: x.q.slice(0, 26), ...x.t }));
if (stages.length) console.table(stages);
if (out) writeFileSync(out, JSON.stringify({ base, at: new Date().toISOString(), summary, rows: rows.map(({ searchData: _s, ...r }) => r) }, null, 2));
