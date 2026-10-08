import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { canSpend, charge, charsToTokens, estimateNeurons, neuronLimit, neuronsFromResponse, releaseBudget, resetAiBudgetState, utcDay } from '../server/aiBudget.ts';
import { resetWorkersAiQuota, workersAiQuotaDown } from '../server/aiQuota.ts';
import { hasLlm, llmJson } from '../server/llm.ts';
import { suggestTypeahead } from '../server/typeahead.ts';
import type { Env } from '../server/util.ts';
import { openBudgetDb } from './memoryBudgetDb.ts';

const realNow = Date.now;

afterEach(() => {
  resetAiBudgetState();
  resetWorkersAiQuota();
  Date.now = realNow;
});

test('estimateNeurons uses the published per-model rates and rounds up', () => {
  assert.equal(estimateNeurons('@cf/meta/llama-3.2-1b-instruct', 1_000_000, 0), 2457);
  assert.equal(estimateNeurons('@cf/meta/llama-3.2-1b-instruct', 0, 1_000_000), 18252);
  assert.equal(estimateNeurons('@cf/meta/llama-3.1-8b-instruct-fast', 1_000_000, 0), 4119);
  assert.equal(estimateNeurons('@cf/meta/llama-3.1-8b-instruct-fast', 0, 1_000_000), 34868);
  assert.equal(estimateNeurons('@cf/meta/llama-3.1-8b-instruct-fp8-fast', 1_000_000, 1_000_000), 4119 + 34868);
  assert.equal(estimateNeurons('@cf/meta/llama-3.1-8b-instruct', 1_000_000, 0), 25608);
  assert.equal(estimateNeurons('@cf/not-listed/model', 1_000_000, 0), 25608);
  assert.equal(estimateNeurons('@cf/meta/llama-3.2-1b-instruct', 0, 0), 0);
  assert.equal(estimateNeurons('@cf/meta/llama-3.2-1b-instruct', 4, 4), 1);
  assert.equal(charsToTokens(0), 0);
  assert.equal(charsToTokens(5), 2);
  assert.equal(neuronsFromResponse('@cf/meta/llama-3.2-1b-instruct', { usage: { prompt_tokens: 1_000_000, completion_tokens: 2 } }, 99), 2457 + 1);
  assert.equal(neuronsFromResponse('@cf/meta/llama-3.2-1b-instruct', { response: 'no usage' }, 99), 99);
  assert.equal(neuronLimit({} as Env), 9500);
  assert.equal(neuronLimit({ AI_NEURON_CAP: '1000' } as Env), 950);
  assert.equal(neuronLimit({ AI_NEURON_CAP: 'nope' } as Env), 9500);
});

test('canSpend refuses once the day total reaches the 95% limit and skips Workers AI like a 4006', async () => {
  const day = utcDay();
  const db = openBudgetDb({ day, neurons: 9500 });
  const env = { DB: db } as Env;
  assert.equal(await canSpend(env, 1), false);
  assert.equal(workersAiQuotaDown(), true);
  assert.equal(db.writes, 0);

  let calls = 0;
  const aiEnv = {
    DB: db,
    AI: { async run() { calls += 1; return { response: { ok: true } }; } },
  } as Env;
  await assert.rejects(() => llmJson(aiEnv, 'system', 'hello'));
  assert.equal(calls, 0);
  assert.equal(hasLlm(aiEnv), false);

  let typeaheadCalls = 0;
  const typed = await suggestTypeahead('quark budget cap', {
    DB: db,
    AI: { async run() { typeaheadCalls += 1; return { response: 'a\nb\nc' }; } },
  } as Env);
  assert.equal(typed.suggestions.length, 0);
  assert.equal(typed.source, 'none');
  assert.equal(typeaheadCalls, 0);
});

test('typeahead at the cap returns no AI lines so the client can use the local list', async () => {
  const db = openBudgetDb({ day: utcDay(), neurons: 9500 });
  let calls = 0;
  const typed = await suggestTypeahead('quark local fallback', {
    DB: db,
    AI: { async run() { calls += 1; return { response: 'a\nb\nc' }; } },
  } as Env);
  assert.equal(calls, 0);
  assert.equal(typed.source, 'none');
  assert.equal(typed.suggestions.length, 0);
  assert.match(typed.reason ?? '', /4006/);
});

test('a new UTC day starts from zero', async () => {
  let now = Date.parse('2026-10-08T23:30:00.000Z');
  Date.now = () => now;
  const db = openBudgetDb({ day: '2026-10-08', neurons: 9400 });
  const env = { DB: db } as Env;
  assert.equal(utcDay(now), '2026-10-08');
  assert.equal(await canSpend(env, 200), false);
  assert.equal(workersAiQuotaDown(), false);
  const selectsOnDay1 = db.selects;

  now = Date.parse('2026-10-09T00:00:01.000Z');
  assert.equal(await canSpend(env, 200), true);
  assert.ok(db.selects > selectsOnDay1);
  releaseBudget(200);
  assert.equal(db.days.get('2026-10-09') ?? 0, 0);
});

test('a missing DB fails closed and does not throw', async () => {
  let calls = 0;
  const env = { AI: { async run() { calls += 1; return { response: { ok: true } }; } } } as Env;
  assert.equal(await canSpend(env, 10), false);
  assert.equal(workersAiQuotaDown(), false);
  await assert.rejects(() => llmJson(env, 'system', 'hello'));
  assert.equal(calls, 0);
  const typed = await suggestTypeahead('quark missing db', env);
  assert.equal(typed.source, 'none');
  assert.equal(typed.reason, 'ai budget');
  assert.equal(typed.suggestions.length, 0);
  assert.equal(calls, 0);
});

test('a D1 error fails closed and does not throw', async () => {
  const env = {
    DB: {
      prepare() {
        throw new Error('D1 unavailable');
      },
    },
  } as Env;
  assert.equal(await canSpend(env, 10), false);
  assert.equal(await canSpend(env, 10), false);
  assert.equal(workersAiQuotaDown(), false);
});

test('charge upserts the UTC day and a warm check does not read D1 again', async () => {
  const db = openBudgetDb();
  const env = { DB: db } as Env;
  assert.equal(await canSpend(env, 5), true);
  const selects = db.selects;
  charge(env, 5, 5);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.days.get(utcDay()), 5);
  assert.match(db.prepared.join('\n'), /ON CONFLICT\(day\) DO UPDATE SET neurons = neurons \+ excluded\.neurons/);
  assert.match(db.prepared.join('\n'), /RETURNING neurons/);
  assert.equal(await canSpend(env, 1), true);
  assert.equal(db.selects, selects);
  releaseBudget(1);
});

test('warm estimate + canSpend stays under 0.5ms', async () => {
  const db = openBudgetDb();
  const env = { DB: db } as Env;
  assert.equal(await canSpend(env, 1), true);
  releaseBudget(1);
  const n = 2000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    estimateNeurons('@cf/meta/llama-3.2-1b-instruct', 48, 60);
    assert.equal(await canSpend(env, 1), true);
    releaseBudget(1);
  }
  const perMs = (performance.now() - t0) / n;
  console.log(`ai-budget warm path ${perMs.toFixed(4)} ms/call`);
  assert.ok(perMs < 0.5, `warm path ${perMs} ms`);
});
