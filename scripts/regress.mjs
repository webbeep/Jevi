#!/usr/bin/env node
// Live regression set for zo.fyi: every ask bypasses the answer cache, so this spends real search and model calls.
// usage: node scripts/regress.mjs [baseUrl] [--only substr] [--out file.json] [--frames frames6.json]
// --frames takes [{i, q, gold}] rows (FRAMES test.tsv indices); the gold is printed next to the card's lead for a human grade.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://zo.fyi').replace(/\/$/, '');
const only = flag('--only');
const out = flag('--out');
const framesFile = flag('--frames');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

async function stream(body) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/stream`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zo-refresh': '1', 'user-agent': UA }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const nodes = new Map();
  const events = [];
  let ev = 'message', buf = '', firstNode;
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
        events.push({ event: ev, data });
        if (ev === 'node') { nodes.set(data.index, data.node); firstNode ??= performance.now() - t0; }
      } else if (!line) ev = 'message';
    }
  }
  const of = (name) => events.filter((e) => e.event === name).map((e) => e.data);
  const head = Object.assign({}, ...of('head'));
  const search = of('search').at(-1);
  const done = of('done').at(-1);
  const body2 = [...nodes.keys()].sort((a, b) => a - b).map((i) => nodes.get(i));
  return { ms: Math.round(performance.now() - t0), firstNode: firstNode && Math.round(firstNode), card: { ...head, body: body2 }, search, done, of, choices: done?.choices ?? [] };
}

const followup = (seed, q, intent) => ({
  kind: 'followup', question: q, original: seed.q, search: seed.r.search,
  cards: [{ id: 1, title: seed.r.card.title, card: seed.r.card }], context: `Asked: ${seed.q}\nCard: ${seed.r.card.title}`, ...(intent ? { intent, from: 1 } : {}),
});
const text = (x) => JSON.stringify(x ?? '');
const hosts = (r) => (r.search?.results ?? []).map((x) => x.domain);
const types = (nodes, acc = []) => {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== 'object') continue;
    acc.push(n.type);
    if (Array.isArray(n.children)) types(n.children, acc);
    if (Array.isArray(n.tabs)) n.tabs.forEach((t) => types(t.children, acc));
  }
  return acc;
};

/** Every picture on the card, with what it shows: pooled refs carry a title, direct sources only a URL. */
function pictures(r) {
  const pool = r.search?.images ?? [];
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.imageRef === 'number' && pool[n.imageRef]) found.push({ at: n.type ?? 'item', label: n.label ?? n.name ?? n.text, ...pool[n.imageRef] });
    if (n.imageSrc) {
      const known = pool.find((p) => p.thumb === n.imageSrc || p.url === n.imageSrc);
      const credit = (r.of?.('credit') ?? []).find((c) => c.src === n.imageSrc);
      found.push({ at: n.type ?? 'item', label: n.label ?? n.name ?? n.text, thumb: n.imageSrc, title: known?.title ?? '', url: known?.url ?? credit?.link ?? '' });
    }
    if (n.type === 'stat' && n.image) found.push({ at: 'stat', label: n.label, thumb: n.image, title: '' });
    if (n.type === 'gallery') {
      for (const ref of n.refs ?? []) if (pool[ref]) found.push({ at: 'gallery', ...pool[ref] });
      for (const p of n.pics ?? []) found.push({ at: 'gallery', thumb: p.src, title: p.title ?? '' });
    }
    if (n.type === 'image' && (n.src || typeof n.ref === 'number')) found.push({ at: 'image', ...(typeof n.ref === 'number' ? pool[n.ref] : { thumb: n.src, title: n.caption ?? '' }) });
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(r.card.body);
  return found;
}

/** A picked person card: the standard profile layout, only that person in pictures, third-person text. */
function personCard(r, name) {
  const t = types(r.card.body);
  const surname = name.toLowerCase().split(/\s+/).pop().replace(/[^a-z]/g, '');
  const pics = pictures(r);
  const stray = pics.filter((p) => p.at !== 'profile' || !`${p.title} ${p.url ?? ''} ${p.thumb}`.toLowerCase().includes(surname));
  const firstPerson = (r.card.body ?? []).filter((n) => n.type === 'text' && /(^|[\s(“"])(I|I'm|my|me)(?=[\s,.;:!?])/.test(n.text));
  const problems = [];
  if (t[0] !== 'profile') problems.push(`first node ${t[0]}`);
  if (!t.includes('tile') && !(r.card.body?.[0]?.facts?.length)) problems.push('no facts');
  if (t.includes('gallery')) problems.push('gallery');
  if (stray.length) problems.push(`other pictures: ${stray.map((p) => `${p.at}:${(p.title || p.thumb).slice(0, 50)}`).join(' | ')}`);
  if (firstPerson.length) problems.push(`first person: ${firstPerson[0].text.slice(0, 80)}`);
  return { ok: !problems.length, detail: `"${r.card.title}" [${[...new Set(t)].join(',')}] pics=${pics.length}${problems.length ? ` ✗ ${problems.join('; ')}` : ''}` };
}

const LONG = 'I am planning a week in Japan next April with two kids aged seven and ten, and we want to see the cherry blossoms in Kyoto and Tokyo without the worst crowds, stay somewhere walkable near a train station, and keep hotels under two hundred dollars a night. Which neighborhoods should we stay in, and when is peak bloom usually?';
const LONG_FOLLOW = 'Thinking about it more, we would rather skip the big cities for part of the trip, so which quieter towns within about two hours of Kyoto by train still have good cherry blossom viewing, family friendly places to stay, and easy day trips that do not need a car or a lot of walking for the kids?';

const CASES = [
  { name: 'long question searched whole', run: async () => {
    const r = await stream({ kind: 'search', query: LONG, freshness: 'any' });
    const q = r.search?.query ?? '';
    return { r, ok: LONG.length > 300 && q.replace(/\s+/g, ' ').trim().startsWith(LONG), detail: `${LONG.length} chars; searched ${q.length} chars; "${r.card.title}"` };
  } },
  { name: 'long follow-up searched whole', run: async () => {
    const seed = { q: 'cherry blossom season in Kyoto' };
    seed.r = await stream({ kind: 'search', query: seed.q, freshness: 'any' });
    const r = await stream(followup(seed, LONG_FOLLOW));
    const rewrites = r.of('rewrite').map((x) => x.query);
    const q = r.search?.query ?? rewrites.at(-1) ?? '';
    const cut = rewrites.some((x) => x.length < LONG_FOLLOW.length && LONG_FOLLOW.startsWith(x));
    return { r, ok: !cut && /town|kyoto|nara|uji|hikone|blossom/i.test(text(r.card)), detail: `${LONG_FOLLOW.length} chars; rewrite ${rewrites.map((x) => x.length).join(',') || 'none'}; searched ${q.length}; "${r.card.title}"` };
  } },
  { name: 'unrelated follow-up stands alone', run: async () => {
    const seed = { q: 'how do mRNA vaccines work' };
    seed.r = await stream({ kind: 'search', query: seed.q, freshness: 'any' });
    const r = await stream(followup(seed, 'What is photosynthesis?'));
    return { r, ok: /photosynth/i.test(r.card.title ?? '') && !/mrna|vaccine/i.test(`${r.card.title} ${r.card.subtitle ?? ''}`), detail: `"${r.card.title}"` };
  } },
  { name: 'related follow-up keeps subject', run: async () => {
    const seed = { q: 'iphone 17 vs pixel 10' };
    seed.r = await stream({ kind: 'search', query: seed.q, freshness: 'any' });
    const r = await stream(followup(seed, 'which one has better battery life?'));
    return { r, ok: /iphone/i.test(text(r.card)) && /pixel/i.test(text(r.card)) && /battery|mah|hour/i.test(text(r.card)), detail: `"${r.card.title}"` };
  } },
  { name: 'AAPL stock follow-up shows the chart', run: async () => {
    const seed = { q: 'who is Marie Curie' };
    seed.r = await stream({ kind: 'search', query: seed.q, freshness: 'any' });
    const r = await stream(followup(seed, 'AAPL stock'));
    const t = types(r.card.body);
    return { r, ok: t.includes('ticker') && !/curie/i.test(r.card.title ?? ''), detail: `"${r.card.title}" [${[...new Set(t)].join(',')}]` };
  } },
  { name: 'Jordan picker', picks: true, q: 'Who is Michael Jordan?', run: async () => {
    const r = await stream({ kind: 'search', query: 'Who is Michael Jordan?', freshness: 'any' });
    return { r, ok: r.choices.length >= 2, detail: r.choices.map((c) => `${c.name} (${c.descriptor})`).join(' | ') };
  } },
  { name: 'Tim from Blueflame', picks: true, q: 'Who is Tim from Blueflame', run: async () => {
    const r = await stream({ kind: 'search', query: 'Who is Tim from Blueflame', freshness: 'any' });
    if (r.choices.length) {
      const atWork = r.choices.every((c) => /blue ?flame/i.test(`${c.descriptor} ${c.query}`) || /estrada/i.test(c.name));
      return { r, ok: atWork, detail: `picker: ${r.choices.map((c) => `${c.name} (${c.descriptor})`).join(' | ')}` };
    }
    const p = personCard(r, 'Timothy Estrada');
    return { r, ok: /estrada/i.test(text(r.card.body?.[0])) && p.ok, detail: `one card: ${p.detail}` };
  } },
  { name: 'Jensen Huang one card', run: async () => {
    const r = await stream({ kind: 'search', query: 'Who is Jensen Huang', freshness: 'any' });
    const p = personCard(r, 'Jensen Huang');
    return { r, ok: !r.choices.length && p.ok, detail: p.detail };
  } },
  { name: 'arXiv preprint leads with arxiv.org', run: async () => {
    const r = await stream({ kind: 'search', query: 'recent arXiv preprints on retrieval augmented generation', freshness: 'any' });
    return { r, ok: hosts(r)[0] === 'arxiv.org', detail: hosts(r).slice(0, 4).join(', ') };
  } },
  { name: 'climate papers doi.org first', run: async () => {
    const r = await stream({ kind: 'search', query: 'Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs', freshness: 'any' });
    return { r, ok: hosts(r)[0] === 'doi.org', detail: hosts(r).slice(0, 4).join(', ') };
  } },
  { name: 'Minnesota lakes 11,842 on the state site', run: async () => {
    const r = await stream({ kind: 'search', query: 'How many lakes are in Minnesota?', freshness: 'any' });
    return { r, ok: /state\.mn\.us$/.test(hosts(r)[0] ?? '') && /11,842/.test(text(r.card)), detail: `${hosts(r)[0]}; ${/11,842/.test(text(r.card)) ? '11,842' : 'no 11,842'}` };
  } },
  { name: 'FDA first', run: async () => {
    const r = await stream({ kind: 'search', query: 'FDA cyclospora outbreak cases', freshness: 'any' });
    return { r, ok: /(^|\.)fda\.gov$/.test(hosts(r)[0] ?? ''), detail: hosts(r).slice(0, 3).join(', ') };
  } },
  { name: 'HDMI price', run: async () => {
    const r = await stream({ kind: 'search', query: 'best hdmi cable for a tv', freshness: 'any' });
    const prices = text(r.card.body).match(/\$\d[\d.,]*/g) ?? [];
    return { r, ok: prices.length >= 1, detail: `${prices.slice(0, 4).join(' ')} "${r.card.title}"` };
  } },
  { name: 'tie video', run: async () => {
    const r = await stream({ kind: 'search', query: 'how to tie a tie video tutorial', freshness: 'any' });
    return { r, ok: types(r.card.body).includes('video'), detail: hosts(r).slice(0, 3).join(', ') };
  } },
  { name: 'news tldr today leads with news', run: async () => {
    const r = await stream({ kind: 'search', query: 'news tldr today', freshness: 'any' });
    const top = (r.search?.results ?? []).slice(0, 5);
    const newsy = (x) => /headline|news|bulletin|top stories/i.test(x.title) || /(?:^|\.)(?:reuters|apnews|bbc|nytimes|theguardian|washingtonpost|npr|cnn|nbcnews|cbsnews|euronews|aljazeera|wsj|bloomberg|usatoday|axios|politico)\.(?:com|org|co\.uk)$/.test(x.domain);
    const ok = !!top[0] && newsy(top[0]) && top.filter(newsy).length >= 4 && !top.some((x) => /tldr/i.test(`${x.domain} ${x.title}`));
    return { r, ok, detail: top.map((x) => x.domain).join(', ') };
  } },
  { name: 'Tomatometer newest season', run: async () => {
    const r = await stream({ kind: 'search', query: "What's the current Tomatometer score of the most recent season of The Lord of the Rings: The Rings of Power on Rotten Tomatoes?", freshness: 'any' });
    return { r, ok: /\d{2}%/.test(text(r.card.body)), detail: `"${r.card.title}" ${(text(r.card.body).match(/\d{2,3}%/g) ?? []).slice(0, 3).join(' ')}` };
  } },
];

async function pickAll(c, r) {
  const rows = [];
  for (const choice of r.choices.slice(0, 3)) {
    const q = choice.query?.trim() || (choice.descriptor ? `${choice.name} (${choice.descriptor})` : choice.name);
    const picked = await stream(followup({ q: c.q, r }, q, 'search'));
    const p = personCard(picked, choice.name);
    rows.push({ name: `${c.name} → pick ${choice.name}`, ok: p.ok, detail: p.detail, ms: picked.ms, firstNode: picked.firstNode });
  }
  return rows;
}

const frames = framesFile ? JSON.parse(readFileSync(framesFile, 'utf8')) : [];
for (const f of frames) {
  CASES.push({ name: `FRAMES ${f.i}`, frames: true, run: async () => {
    const r = await stream({ kind: 'search', query: f.q, freshness: 'any' });
    const flat = [];
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); flat.push(n); Object.values(n).forEach(walk); };
    walk(r.card.body);
    const hero = flat.find((n) => n.type === 'hero');
    const marks = flat.filter((n) => n.type === 'table' || n.type === 'keyvalue' || n.type === 'list' || n.type === 'tile').map((n) => JSON.stringify(n.rows ?? n.items ?? [n.label, n.value, n.sub]).replace(/"(type|icon|source|active)":("[^"]*"|\d+|true|false),?/g, '')).join(' ');
    const lead = [hero && `${hero.value} ${hero.label ?? ''}`, flat.find((n) => n.type === 'text')?.text, marks].filter(Boolean).join(' / ');
    return { r, ok: null, detail: `lead: ${lead.slice(0, 600)} || gold: ${f.gold}` };
  } });
}

const list = only ? CASES.filter((c) => c.name.toLowerCase().includes(only.toLowerCase())) : CASES;
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < list.length) {
    const c = list[next++];
    try {
      const { r, ok, detail } = await c.run();
      const row = { name: c.name, ok, detail, ms: r.ms, firstNode: r.firstNode };
      results.push(row);
      console.log(`${ok === null ? '?' : ok ? '✓' : '✗'} ${String(r.ms).padStart(6)}ms  ${c.name}: ${detail}`);
      if (c.picks && r.choices.length) for (const p of await pickAll(c, r)) {
        results.push(p);
        console.log(`${p.ok ? '✓' : '✗'} ${String(p.ms).padStart(6)}ms  ${p.name}: ${p.detail}`);
      }
    } catch (err) {
      results.push({ name: c.name, ok: false, detail: String(err) });
      console.log(`✗ ${c.name}: ${err}`);
    }
  }
}));

if (!only) {
  const html = await (await fetch(`${base}/`, { headers: { 'user-agent': UA } })).text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  results.push({ name: 'title zo', ok: title === 'zo', detail: `"${title}"` });
  console.log(`${title === 'zo' ? '✓' : '✗'} title: "${title}"`);
  const png = Buffer.from(await (await fetch(`${base}/og-card.png`)).arrayBuffer());
  const sha = createHash('sha256').update(png).digest('hex');
  const same = sha === '16e85d0d74a3aeaeb273dee86c0c9e7c9c02dc9ce275982f0ac1b24240dedec0';
  results.push({ name: '/og-card.png unchanged', ok: same, detail: `${png.length} bytes ${sha.slice(0, 12)}` });
  console.log(`${same ? '✓' : '✗'} /og-card.png ${png.length} bytes ${sha.slice(0, 12)}`);
}
const times = results.map((x) => x.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log(`\n${results.filter((x) => x.ok === false).length} failed of ${results.filter((x) => x.ok !== null).length}; answer time p50 ${pct(0.5)}ms p95 ${pct(0.95)}ms (n=${times.length})`);
if (out) writeFileSync(out, JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
