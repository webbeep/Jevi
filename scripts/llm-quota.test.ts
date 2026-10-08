import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { resetAiBudgetState } from '../server/aiBudget.ts';
import { isQuotaError, nextUtcMidnight, resetWorkersAiQuota, workersAiQuotaDown } from '../server/aiQuota.ts';
import { hasLlm, llmJson, trimForWorkersAi } from '../server/llm.ts';
import type { Env } from '../server/util.ts';
import { openBudgetDb } from './memoryBudgetDb.ts';

const realNow = Date.now;

afterEach(() => {
  resetWorkersAiQuota();
  resetAiBudgetState();
  Date.now = realNow;
});

test('nextUtcMidnight is the following UTC midnight, including when now is already midnight', () => {
  assert.equal(nextUtcMidnight(Date.parse('2026-10-08T03:10:00.000Z')), Date.parse('2026-10-09T00:00:00.000Z'));
  assert.equal(nextUtcMidnight(Date.parse('2026-10-09T00:00:00.000Z')), Date.parse('2026-10-10T00:00:00.000Z'));
});

test('isQuotaError matches the daily neuron allocation and ignores timeouts', () => {
  assert.equal(isQuotaError('4006: you have used up your daily free allocation of 10,000 neurons'), true);
  assert.equal(isQuotaError('timed out'), false);
});

test('trimForWorkersAi keeps a short prompt and both ends of a long one', () => {
  assert.equal(trimForWorkersAi('sources\nQUERY: test', 4000), 'sources\nQUERY: test');
  const cap = 4000;
  const user = `${'S'.repeat(12_000)}TAIL-MARK ${'q'.repeat(2000)}QUERY: test`;
  const trimmed = trimForWorkersAi(user, cap);
  const tailLen = Math.min(1600, Math.floor(cap * 0.4));
  assert.equal(trimmed.length, cap);
  assert.equal(trimmed.startsWith('S'.repeat(cap - tailLen - 3)), true);
  assert.equal(trimmed.endsWith(user.slice(-tailLen)), true);
  assert.equal(trimmed.includes('\n…\n'), true);
  assert.equal(trimForWorkersAi('abcdefghijklmnop', 10), 'abc\n…\nmnop');
});

test('a neuron quota error hides Workers AI until the next UTC midnight', async () => {
  resetWorkersAiQuota();
  const fixed = Date.parse('2026-10-08T03:10:00.000Z');
  Date.now = () => fixed;
  let calls = 0;
  const env = {
    DB: openBudgetDb(),
    AI: {
      async run() {
        calls += 1;
        throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
      },
    },
  } as Env;
  await assert.rejects(() => llmJson(env, 'system', 'hello'));
  assert.equal(hasLlm(env), false);
  await assert.rejects(() => llmJson(env, 'system', 'hello again'));
  assert.equal(calls, 1);
  Date.now = () => nextUtcMidnight(fixed) + 1;
  assert.equal(hasLlm(env), true);
  assert.equal(workersAiQuotaDown(), false);
});

test('a non-quota binding error does not trip the daily quota flag', async () => {
  resetWorkersAiQuota();
  let calls = 0;
  const env = {
    DB: openBudgetDb(),
    AI: {
      async run() {
        calls += 1;
        throw new Error('timed out');
      },
    },
  } as Env;
  await assert.rejects(() => llmJson(env, 'system', 'hello'));
  assert.equal(workersAiQuotaDown(), false);
  assert.equal(hasLlm(env), true);
  await assert.rejects(() => llmJson(env, 'system', 'hello'));
  assert.equal(calls, 2);
});

test('the binding defaults to the 8b model and a user message within 4000 chars', async () => {
  resetWorkersAiQuota();
  let model = '';
  let user = '';
  const env = {
    DB: openBudgetDb(),
    AI: {
      async run(m: string, input: { messages?: { role?: string; content?: string }[] }) {
        model = m;
        user = input.messages?.find((msg) => msg.role === 'user')?.content ?? '';
        return { response: { ok: true } };
      },
    },
  } as Env;
  const prompt = `${'s'.repeat(20_000)}QUERY: test`;
  await llmJson(env, 'system', prompt);
  assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fast');
  assert.ok(user.length <= 4000);
  assert.equal(user.endsWith('QUERY: test'), true);
});
