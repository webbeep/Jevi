import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asksToCompare, cryptographyHint, faithfulQuery, isWritingAsk, needsOwnSearch, personQuestion, scrubLeak, standsAlone, withoutLeakActions, withoutRepeatedCallouts } from '../server/askGuard.ts';
import { isPersonAsk } from '../server/entity.ts';
import { planLayout } from '../server/plan.ts';
import type { CardNode } from '../shared/card.ts';

test('a writing request is answered, not searched, and a complete question is not rewritten', () => {
  assert.equal(isWritingAsk('Draft the unblock email'), true);
  assert.equal(isWritingAsk('write a short apology email for missing a meeting'), true);
  assert.equal(isWritingAsk('how do mRNA vaccines work'), false);
  assert.equal(standsAlone('How to use the IACR API'), true);
  assert.equal(standsAlone('explain it like I am 10'), false);
  assert.equal(asksToCompare('AJ Dybantsa vs 2026 NBA rookies vs past draft classes'), true);
  assert.equal(asksToCompare('compare this with that'), false);
});

test('a rewrite that drops the question, or picks up a banned address, is thrown out', () => {
  assert.equal(faithfulQuery('Draft the unblock email', 'Takes Two, 2a06:98c0:3600::103'), 'Draft the unblock email');
  assert.equal(faithfulQuery('Draft the unblock email', 'Takes Two proofs of work'), 'Draft the unblock email');
  assert.equal(faithfulQuery('explain it like I am 10', 'mRNA vaccines explained for a child'), 'mRNA vaccines explained for a child');
  assert.equal(faithfulQuery('apple varieties', 'best apple varieties for apple pie'), 'best apple varieties for apple pie');
  assert.equal(
    faithfulQuery('AJ Dybantsa preseason highlights', 'AJ Dybantsa Wizards washington stats'),
    'AJ Dybantsa preseason highlights',
  );
});

test('ban notices and addresses are scrubbed, and the chip that offers them never shows', () => {
  const dirty = 'Paper: It Takes Two.\nYour IP address of 2a06:98c0:3600::103 has been blocked for automated fetches in violation of robots.txt.';
  assert.equal(scrubLeak(dirty).includes('2a06'), false);
  assert.equal(scrubLeak(dirty).includes('It Takes Two'), true);
  const actions: Extract<CardNode, { type: 'actions' }> = {
    type: 'actions',
    items: [
      { label: 'Draft the unblock email', query: 'Draft an email to eprint-abuse about the blocked IP' },
      { label: 'Find the paper on arXiv', query: 'It Takes Two proofs of work arXiv' },
    ],
  };
  assert.deepEqual(withoutLeakActions(actions)?.items.map((i) => i.label), ['Find the paper on arXiv']);
});

test('a person follow-up is its own search, and a pronoun or a writing request is not', () => {
  assert.equal(personQuestion('What is Priya Natarajan?'), 'Who is Priya Natarajan?');
  assert.equal(personQuestion('What is BlueFlame AI?'), 'What is BlueFlame AI?');
  assert.equal(personQuestion("What is Priya Natarajan's college?"), "What is Priya Natarajan's college?");
  assert.equal(needsOwnSearch('What is Priya Natarajan?', 'NBA scores tonight'), true);
  assert.equal(needsOwnSearch("What is Priya Natarajan's college?", 'NBA scores tonight'), true);
  assert.equal(needsOwnSearch('What is photosynthesis?', 'how do mRNA vaccines work'), false);
  assert.equal(needsOwnSearch('Who is Priya Natarajan?', 'Priya Natarajan'), false);
  assert.equal(needsOwnSearch('explain it like I am 10', 'how do mRNA vaccines work'), false);
  assert.equal(needsOwnSearch('which one has better battery life?', 'iphone 17 vs pixel 10'), false);
  assert.equal(needsOwnSearch('Draft the unblock email', 'It Takes Two'), false);
});

test('a person follow-up is a search when the planner is unavailable', async () => {
  const person = await planLayout('What is Priya Natarajan?', {} as never, { original: 'NBA scores tonight' });
  assert.equal(person.mode, 'search');
  assert.equal(person.pattern, 'profile');
  const chat = await planLayout('explain it like I am 10', {} as never, { original: 'how do mRNA vaccines work' });
  assert.equal(chat.mode, 'chat');
});

test('a query carrying an address is never a person to disambiguate', () => {
  assert.equal(isPersonAsk('Takes Two, 2a06:98c0:3600::103'), false);
  assert.equal(isPersonAsk('Who is Jessica Chen'), true);
});

test('a region keeps its list when only its warning repeats one already shown', () => {
  const shown: CardNode[] = [{ type: 'callout', tone: 'warning', title: 'No recent news', text: 'No dated news about Jessica Chen at NYU and cryptocurrency was found.' }];
  const region: CardNode = {
    type: 'section',
    children: [
      { type: 'callout', tone: 'warning', title: 'No recent news', text: 'No dated news about Jessica Chen at NYU and cryptocurrency.' },
      { type: 'list', items: [{ text: 'The paper credits Jessica Chen at NYU' }] },
    ],
  };
  const kept = withoutRepeatedCallouts(region, shown);
  assert.equal(kept?.type, 'section');
  assert.deepEqual(kept && 'children' in kept ? kept.children.map((c) => c.type) : [], ['list']);
});

test('"crypto" beside cryptography papers means the field', () => {
  const rows = [{ title: 'Proofs of Work for Fiat–Shamir', snippet: 'cryptography, New York University', url: 'https://eprint.iacr.org/2026/2326' }];
  assert.match(cryptographyHint('latest on Jessica Chen nyu crypto', rows) ?? '', /cryptography/);
  assert.equal(cryptographyHint('bitcoin price today', rows), undefined);
});
