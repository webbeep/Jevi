import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptIdeas, fillIdeas } from '../shared/homeIdeas.ts';
import { buildHomeIdeas } from '../server/homeIdeas.ts';
import type { Env } from '../server/util.ts';

const env = {} as Env;

test('model ideas drop repeats of asks and follow-ups', () => {
  const ideas = acceptIdeas(
    [
      { text: 'jaylen brown injuries', icon: 'newspaper' },
      { text: 'Jaylen Brown next game', icon: 'calendar' },
      { text: 'What would a Celtics playoff series look like', icon: 'nope' },
      { text: 'RDW cash on hand versus its burn', icon: 'chart-line' },
      { text: 'hi', icon: 'search' },
    ],
    ['jaylen brown injuries', 'Jaylen Brown next game'],
    4,
  );
  assert.deepEqual(ideas.map((item) => item.text), [
    'What would a Celtics playoff series look like',
    'RDW cash on hand versus its burn',
  ]);
  assert.equal(ideas[0]?.icon, 'sparkles');
  assert.equal(ideas[1]?.icon, 'chart-line');
});

test('template ideas fill only the slots the model left open', () => {
  const primary = [{ id: 'i-0', text: 'Celtics playoff path', icon: 'activity', group: 'broad' as const }];
  const fallback = [
    { id: 'p-0', text: 'Celtics playoff path', icon: 'search', group: 'broad' as const },
    { id: 'p-1', text: 'RDW earnings date', icon: 'calendar', group: 'broad' as const },
  ];
  assert.deepEqual(fillIdeas(primary, fallback, 2).map((item) => item.text), ['Celtics playoff path', 'RDW earnings date']);
});

test('a good model reply is kept and a failed one falls back to the template list', async () => {
  const body = {
    asks: ['why $rdw dropping', 'jaylen brown injuries'],
    followups: ['Jaylen Brown next game'],
    want: 4,
  };
  const ok = await buildHomeIdeas(env, body, async () => ({
    ideas: [
      { text: 'RDW runway if revenue stays flat', icon: 'chart-line' },
      { text: 'Celtics without Jaylen Brown', icon: 'activity' },
      { text: 'Jaylen Brown next game', icon: 'calendar' },
      { text: 'Best wireless earbuds under $100', icon: 'headphones' },
    ],
  }));
  assert.equal(ok.source, 'llm');
  assert.equal(ok.suggestions.length, 4);
  assert.ok(ok.suggestions.some((item) => item.text === 'RDW runway if revenue stays flat'));
  assert.ok(!ok.suggestions.some((item) => /next game/i.test(item.text)));

  const failed = await buildHomeIdeas(env, body, async () => { throw new Error('down'); });
  assert.equal(failed.source, 'template');
  assert.ok(failed.suggestions.length >= 2);
  assert.ok(failed.suggestions.some((item) => /rdw/i.test(item.text)));

  const thin = await buildHomeIdeas(env, body, async () => ({ ideas: [{ text: 'Only one usable idea here', icon: 'search' }] }));
  assert.equal(thin.source, 'template');
});

test('no history skips the model', async () => {
  let called = false;
  const out = await buildHomeIdeas(env, { asks: [], followups: [], want: 4 }, async () => { called = true; return { ideas: [] }; });
  assert.equal(called, false);
  assert.equal(out.source, 'template');
  assert.ok(out.suggestions.length >= 3);
});
