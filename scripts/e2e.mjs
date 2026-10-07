#!/usr/bin/env node
/**
 * End-to-end check of the streaming API: a search, then every kind of follow-up
 * (card adjust, card ask, card search, typed). Usage: node scripts/e2e.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
let failures = 0;

function check(ok, label, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** POSTs a stream request and collects its Server-Sent Events. */
async function stream(body) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const events = [];
  let firstNodeMs;
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = frame.match(/^event: (.*)$/m)?.[1];
      const data = frame.match(/^data: (.*)$/m)?.[1];
      if (!event || !data) continue;
      if (event === 'node' && firstNodeMs === undefined) firstNodeMs = Date.now() - started;
      events.push({ event, data: JSON.parse(data) });
    }
  }
  const of = (name) => events.filter((e) => e.event === name).map((e) => e.data);
  const nodes = [];
  of('node').forEach(({ index, node }) => (nodes[index] = node));
  const head = of('head')[0];
  return { events, of, nodes: nodes.filter(Boolean), head, card: { title: head?.title ?? '', body: nodes.filter(Boolean) }, ms: Date.now() - started, firstNodeMs };
}

const words = (o) => JSON.stringify(o).toLowerCase();

async function main() {
  console.log(`E2E against ${BASE}\n`);

  console.log('health');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check(health.jev && health.llm?.[0] === 'DeepSeek', 'Jev configured, DeepSeek first', JSON.stringify(health));

  console.log('suggestions');
  const sug = await (await fetch(`${BASE}/api/suggestions`)).json();
  check(Array.isArray(sug.suggestions ?? sug) && (sug.suggestions ?? sug).length >= 4, 'home suggestions');

  console.log('search: "apple pie recipe"');
  const s = await stream({ kind: 'search', query: 'apple pie recipe', freshness: 'any' });
  const search = s.of('search')[0];
  const plan = s.of('plan')[0];
  check(!s.of('error').length, 'no error event', s.of('error')[0]?.message);
  check(!!plan?.pattern, 'layout plan', plan && `${plan.pattern} via ${plan.engine}`);
  check(search?.results.length >= 5, 'search results', `${search?.results.length} results`);
  const offTopic = (search?.results ?? []).filter((r) => !/pie|apple|recipe/i.test(`${r.title} ${r.snippet}`));
  check(offTopic.length <= 1, 'results stay on topic', offTopic.map((r) => r.domain).join(', ') || 'all relevant');
  check(!(search?.results ?? []).some((r) => /^(www\.)?apple\.com$|bestbuy/.test(r.domain)), 'no apple.com / bestbuy noise');
  check(s.nodes.length >= 3, 'card designed', `${s.nodes.length} nodes, first after ${s.firstNodeMs}ms, done in ${s.ms}ms`);
  check(!!s.of('done')[0], 'done event');
  const images = [...(search?.images ?? []), ...s.of('images').flat()];
  check(images.every((i) => ['open', 'stock', 'source'].includes(i.license)), 'every search image carries a license', `${images.length} images`);
  const credits = s.of('credit');
  check(credits.every((c) => c.credit && c.link && c.license), 'found pictures are credited', `${credits.length} credits: ${credits.slice(0, 3).map((c) => c.credit).join(' | ')}`);
  check(!words(s.events).includes('bing.com/th'), 'no Bing-scraped images');

  const card = { id: 1, title: s.card.title, card: s.card, pattern: plan?.pattern };
  const base = { original: 'apple pie recipe', search, cards: [card], context: `Topic: apple pie recipe\nLatest card (Q: apple pie recipe): ${s.card.title}` };

  console.log('card search button: "apple varieties"');
  const cs = await stream({ kind: 'followup', question: 'apple varieties', intent: 'search', from: 1, ...base });
  const rewrite = cs.of('rewrite')[0]?.query ?? '';
  check(/pie/i.test(rewrite), 'search keeps the conversation subject', `"${rewrite}"`);
  check(cs.nodes.length >= 2, 'new search card', `${cs.nodes.length} nodes in ${cs.ms}ms`);
  const picked = cs.of('credit');
  check(!picked.some((c) => /@|\[at\]|\b(GFDL|NC|ND)\b/i.test(c.credit)), 'credits are clean and commercially usable', picked.map((c) => c.credit).join(' | '));
  check(picked.length >= 1 && picked.every((c) => c.credit && c.link && ['open', 'stock', 'source'].includes(c.license)), 'item pictures found and credited', picked.slice(0, 3).map((c) => `${c.credit} [${c.license}]`).join(' | '));

  console.log('card adjust: "Show the apple pie recipe using Honeycrisp apples"');
  const ca = await stream({ kind: 'followup', question: 'Show the apple pie recipe using Honeycrisp apples', intent: 'adjust', from: 1, ...base });
  check(ca.of('base')[0]?.id === 1, 'adjusts the card it came from (base event)');
  check(!ca.events.some((e) => e.event === 'target'), 'never overwrites the original card');
  check(ca.nodes.length >= 2 && /honeycrisp/i.test(words(ca.card)), 'adjusted card applies the change', `"${ca.card.title}" in ${ca.ms}ms`);

  console.log('card ask: "How long does apple pie keep?"');
  const ck = await stream({ kind: 'followup', question: 'How long does apple pie keep?', intent: 'ask', from: 1, ...base });
  check(!ck.of('base').length, 'ask is answered, not treated as an adjustment');
  check(ck.nodes.length >= 1, 'answer card', `"${ck.card.title}" in ${ck.ms}ms`);

  console.log('typed follow-up: "can I make it the day before?"');
  const ct = await stream({ kind: 'followup', question: 'can I make it the day before?', ...base });
  check(ct.nodes.length >= 1, 'answer card', `mode ${ct.of('plan')[0]?.mode}, "${ct.card.title}" in ${ct.ms}ms`);
  check(/pie|bake|crust/i.test(words(ct.card)), '"it" resolved to the apple pie');

  console.log('product pictures: "best running shoes for beginners"');
  const ps = await stream({ kind: 'search', query: 'best running shoes for beginners', freshness: 'any' });
  const productCredits = ps.of('credit');
  check(productCredits.length >= 3, 'each product gets its own picture', `${productCredits.length} pictures: ${productCredits.slice(0, 4).map((c) => c.credit).join(', ')}`);
  check(new Set(productCredits.map((c) => c.src)).size === productCredits.length, 'no picture reused');

  console.log('writing task: "write an email to my landlord about a broken heater"');
  const wd = await stream({ kind: 'search', query: 'write an email to my landlord about a broken heater', freshness: 'any' });
  const draft = wd.nodes.find((n) => n.type === 'draft');
  check(wd.of('plan')[0]?.pattern === 'draft', 'planned as a draft', wd.of('plan')[0]?.pattern);
  check(!!draft && /heat/i.test(draft.text) && draft.text.length > 200, 'complete draft to copy', `${draft?.text.length ?? 0} chars in ${wd.ms}ms`);

  console.log('code task: "python function to remove duplicates from a list but keep order"');
  const cd = await stream({ kind: 'search', query: 'python function to remove duplicates from a list but keep order', freshness: 'any' });
  const code = JSON.stringify(cd.nodes).match(/"type":"code"/);
  check(!!code && /def /.test(words(cd.nodes)), 'working code block', `${cd.of('plan')[0]?.pattern} in ${cd.ms}ms`);

  console.log('titles');
  for (const [label, t] of [['apple pie', s.card.title], ['shoes', ps.card.title], ['email', wd.card.title], ['code', cd.card.title]]) {
    check(t.length > 0 && t.length <= 48 && !/\?$/.test(t), `${label} card has a short screen title`, `"${t}"`);
  }

  console.log(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
