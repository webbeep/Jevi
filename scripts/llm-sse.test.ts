// Loop T: the token-frame fast path and the newline-only line split must give the same text and lines as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentDelta, llmLines } from '../server/llm.ts';

const frame = (delta: object, extra: object = {}) =>
  JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'deepseek-chat', ...extra, choices: [{ index: 0, delta, logprobs: null, finish_reason: null }] });

/** What the full-parse path takes from a frame (the reference behaviour). */
function slow(data: string): string | undefined {
  const obj = JSON.parse(data) as { response?: string; choices?: { delta?: { content?: string } }[] };
  return obj.choices?.[0]?.delta?.content ?? obj.response;
}

test('contentDelta matches a full JSON.parse on content-only token frames', () => {
  for (const s of ['ab', '', ' "q"', 'a\\\\', '\\\\"', 'line\nnext', 'tab\there', 'é✓😀', '\u2028', '{"k":"v"}', 'ends with \\']) {
    const data = frame({ content: s });
    assert.equal(contentDelta(data), slow(data), JSON.stringify(s));
  }
});

test('contentDelta defers to the full parse for any other frame shape', () => {
  for (const data of [
    frame({ role: 'assistant', content: '' }),
    frame({ content: null, reasoning_content: 'think' }),
    frame({ content: 'x', reasoning_content: null }),
    frame({}),
    JSON.stringify({ response: 'workers ai' }),
    '{"a":"\\"delta\\":{\\"content\\":\\"no\\"}"}',
  ]) assert.equal(contentDelta(data), undefined, data);
});

test('llmLines emits the same trimmed lines however the stream is chunked', async () => {
  const text = '{"type":"text","text":"first line é"}\n\n  {"type":"stat","value":"42"}  \n{"type":"list","items":["a\\nb"]}\nlast without newline';
  const want = ['{"type":"text","text":"first line é"}', '{"type":"stat","value":"42"}', '{"type":"list","items":["a\\nb"]}', 'last without newline'];
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += 3) pieces.push(text.slice(i, i + 3));
  const frames = [frame({ role: 'assistant', content: '' }), ...pieces.map((s) => frame({ content: s }))];
  const sse = `${frames.map((f) => `data: ${f}\n\n`).join('')}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(sse);
  const real = globalThis.fetch;
  // post() leaves its 60s whole-answer timer armed on success; unref it so the test run does not wait for it.
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { const t = realTimeout(fn, ms); t.unref?.(); return t; }) as typeof setTimeout;
  try {
    for (const size of [1, 7, 64, bytes.length]) {
      globalThis.fetch = (async () =>
        new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } }), { status: 200 })) as typeof fetch;
      const lines: string[] = [];
      await llmLines({ LLM_API_KEY: 'k', LLM_BASE_URL: 'http://mock', LLM_MODEL: 'm', LLM_ORDER: 'custom' }, 'sys', 'user', 100, (l) => lines.push(l));
      assert.deepEqual(lines, want, `chunk size ${size}`);
    }
  } finally {
    globalThis.fetch = real;
    globalThis.setTimeout = realTimeout;
  }
});
