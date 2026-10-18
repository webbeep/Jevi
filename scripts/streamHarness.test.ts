import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { runStream } from '../server/stream.ts';
import type { Env } from '../server/util.ts';

/**
 * The whole design pipeline with a scripted model: each region answers after its own delay,
 * so the order the client receives components can be checked without a network.
 */
type Reply = { ms: number; lines?: string[]; status?: number };
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const RESULTS = [
  { title: 'Apple pie recipe', url: 'https://a.example/pie', domain: 'a.example', snippet: 'Bake the pie at 425F for about 42 minutes until golden.', engines: ['ddg'] },
  { title: 'Flaky crust tips', url: 'https://b.example/crust', domain: 'b.example', snippet: 'Use cold butter for a flaky crust. Let it cool 2 hours before slicing.', engines: ['ddg'] },
];
const HERO = '{"type":"hero","value":"42 minutes","label":"Bake time"}';
const TEXT = '{"type":"text","text":"Bake the pie at 425F for about 42 minutes until golden. [1]"}';
const LIST = '{"type":"section","title":"Good to know","children":[{"type":"list","items":[{"text":"Use cold butter for a flaky crust. [2]"},{"text":"Let it cool 2 hours before slicing. [2]"}]}]}';
const FINISH = ['{"title":"Apple pie bake time","subtitle":"How long to bake","icon":"clock"}', '{"type":"citations","refs":[1,2]}', '{"followups":["How long should apple pie cool?"]}'];

async function design(script: Record<'R1' | 'R2' | 'R3' | 'FINISH', Reply>) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content: string }[]; stream?: boolean };
    // The source brief and the review are plain calls; an empty answer leaves the card as designed.
    if (!body.stream) return Response.json({ choices: [{ message: { content: '{}' } }] });
    const user = body.messages?.map((m) => m.content).join('\n') ?? '';
    const part = (['R1', 'R2', 'R3'] as const).find((r) => user.includes(`YOU DESIGN ${r}:`)) ?? (user.includes('YOU DESIGN FINISH') ? 'FINISH' : undefined);
    const reply: Reply = part ? script[part] : { ms: 5, lines: ['{}'] };
    await new Promise((resolve) => setTimeout(resolve, reply.ms));
    if (reply.status) return new Response('{"error":"bad"}', { status: reply.status });
    const sse = (reply.lines ?? []).map((line) => `data: ${JSON.stringify({ choices: [{ delta: { content: `${line}\n` } }] })}\n\n`).join('');
    return new Response(`${sse}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  const env = { LLM_API_KEY: 'k', LLM_BASE_URL: 'http://llm.test', LLM_MODEL: 'm', LLM_ORDER: 'custom' } as unknown as Env;
  const events: { event: string; data: { index?: number; node?: { type: string } } }[] = [];
  const search = { query: 'how long to bake apple pie', freshness: 'any' as const, results: RESULTS, images: [], discussions: [], engines: [] };
  await runStream({ kind: 'design', query: search.query, pattern: 'answer', depth: 'brief', readPages: false, search }, env, (event, data) => {
    events.push({ event, data: data as { index?: number; node?: { type: string } } });
  });
  return events;
}

const at = (events: { event: string; data: { index?: number } }[], event: string, index?: number) =>
  events.findIndex((e) => e.event === event && (index === undefined || e.data.index === index));

test('each component goes out as soon as its own region is written', async () => {
  const events = await design({ R1: { ms: 160, lines: [HERO] }, R2: { ms: 10, lines: [TEXT] }, R3: { ms: 60, lines: [LIST] }, FINISH: { ms: 110, lines: FINISH } });
  assert.ok(at(events, 'layout') >= 0);
  assert.ok(at(events, 'layout') < at(events, 'node', 1), 'the layout is known before any component');
  assert.ok(at(events, 'node', 1) < at(events, 'node', 2), 'the fastest region shows first');
  assert.ok(at(events, 'node', 2) < at(events, 'head'), 'components do not wait for the title');
  assert.ok(at(events, 'head') < at(events, 'node', 0), 'the slow lead fills in last');
  assert.ok(at(events, 'node', 0) < at(events, 'done'));
  assert.equal(at(events, 'error'), -1);
});

test('a region that fails or writes nothing usable leaves the other components alone', async () => {
  const events = await design({ R1: { ms: 10, status: 400 }, R2: { ms: 20, lines: ['this is not a node'] }, R3: { ms: 30, lines: [LIST] }, FINISH: { ms: 40, lines: FINISH } });
  assert.equal(at(events, 'error'), -1);
  assert.ok(at(events, 'node', 2) >= 0, 'the healthy region is on the card');
  assert.ok(at(events, 'done') > at(events, 'node', 2));
  const sections = events.filter((e) => e.event === 'node' && e.data.index === 2);
  assert.ok(sections.every((e) => e.data.node?.type === 'section'), 'nothing else takes the healthy slot');
});

test('a slot is never sent the same component twice', async () => {
  const events = await design({ R1: { ms: 30, lines: [HERO] }, R2: { ms: 10, lines: [TEXT] }, R3: { ms: 20, lines: [LIST] }, FINISH: { ms: 40, lines: FINISH } });
  const last = new Map<number, string>();
  for (const e of events) {
    if (e.event !== 'node' || e.data.index === undefined) continue;
    const key = JSON.stringify(e.data.node);
    assert.notEqual(last.get(e.data.index), key, `slot ${e.data.index} was re-sent unchanged`);
    last.set(e.data.index, key);
  }
});
