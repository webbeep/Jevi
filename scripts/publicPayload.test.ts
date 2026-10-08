import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicEvent } from '../server/publicPayload.ts';

test('plan event drops the router engine name; other plan fields stay', () => {
  const { data } = publicEvent('plan', { engine: 'jev', mode: 'card', confidence: 0.8 });
  assert.deepEqual(data, { mode: 'card', confidence: 0.8 });
  assert.equal(JSON.stringify(data).includes('jev'), false);
});

test('done keeps the answer kind but moves the model name to the server log', () => {
  const out = publicEvent('done', { engine: 'composed', via: 'some-model', ms: 1 });
  assert.deepEqual(out, { data: { engine: 'composed', ms: 1 }, via: 'some-model' });
});

test('search engine names become web', () => {
  const { data } = publicEvent('search', { results: [{ url: 'https://a.b', engines: ['you-keyless', 'serper'] }], engines: [{ name: 'langsearch', ok: true }] });
  assert.deepEqual((data as { results: { engines: string[] }[] }).results[0].engines, ['web', 'web']);
  assert.equal((data as { engines: { name: string }[] }).engines[0].name, 'web');
});
