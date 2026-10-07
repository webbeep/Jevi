import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sseResponse } from '../server/sse.ts';
import { StreamError, parseSseFrames, shouldAutoRetry } from '../shared/sse-parse.ts';

const body = async (res: Response) => new Response(res.body).text();

test('sseResponse sends error when work resolves without done or error', async () => {
  const text = await body(sseResponse(async () => {}));
  assert.match(text, /event: error/);
  assert.match(text, /The answer stopped early/);
  assert.match(text, /"retryable":true/);
});

test('sseResponse marks a thrown error retryable', async () => {
  const text = await body(sseResponse(async () => {
    throw new Error('designer failed');
  }));
  assert.match(text, /event: error/);
  assert.match(text, /designer failed/);
  assert.match(text, /"retryable":true/);
});

test('sseResponse does not append an error after done', async () => {
  const text = await body(sseResponse(async (send) => {
    send('done', { engine: 'composed' });
  }));
  assert.match(text, /event: done/);
  assert.equal(text.includes('event: error'), false);
});

test('frame parser marks a body that ends without done as cut', () => {
  const open = 'event: head\ndata: {"title":"Hi"}\n\n';
  assert.equal(parseSseFrames(open).cut, true);
  const done = `${open}event: done\ndata: {"engine":"composed","removed":0,"pagesRead":0,"ms":1}\n\n`;
  assert.equal(parseSseFrames(done).cut, false);
  const error = 'event: error\ndata: {"message":"no"}\n\n';
  assert.equal(parseSseFrames(error).cut, false);
});

test('shouldAutoRetry truth table', () => {
  const cut = new StreamError('The answer was cut off.', 'cut', true);
  assert.equal(shouldAutoRetry(cut, 0, false), true);
  assert.equal(shouldAutoRetry(cut, 1, false), false);
  assert.equal(shouldAutoRetry(cut, 0, true), false);
  const server = new StreamError('designer failed', 'server', true);
  assert.equal(shouldAutoRetry(server, 0, false), false);
  const http400 = new StreamError('Request failed (400)', 'http', false);
  assert.equal(shouldAutoRetry(http400, 0, false), false);
});
