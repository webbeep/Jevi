import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import type { SearchResult } from '../shared/types.ts';
import { sanitizeNodes, stripMarkup } from '../server/sanitize.ts';
import { VerdictSession } from '../server/verdict.ts';

function hit(partial: Partial<SearchResult> & Pick<SearchResult, 'title' | 'url' | 'domain'>): SearchResult {
  return { snippet: '', engines: [], ...partial };
}

function hero(node: CardNode): Extract<CardNode, { type: 'hero' }> | undefined {
  if (node.type === 'hero') return node;
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    for (const c of node.children) {
      const h = hero(c);
      if (h) return h;
    }
  }
  return undefined;
}

function texts(node: CardNode): string[] {
  if (node.type === 'text') return [node.text];
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') return node.children.flatMap(texts);
  return [];
}

test('Q07: Mixed / Yes headline yields to guideline language in the results', () => {
  const lead: CardNode = {
    type: 'stack',
    children: [
      { type: 'hero', value: 'Mixed', label: 'Evidence on red wine & heart health', caption: '36 studies reviewed: 28 positive, 2 adverse, 6 no effect [1]', tone: 'warning' },
      {
        type: 'stack',
        children: [
          { type: 'text', text: '**Yes, in part — mainly the polyphenols, not the alcohol.** "Moderate RW consumption may improve cardiovascular health." [1]' },
          { type: 'text', text: '**But the benefit is not universal." [4]' },
          { type: 'text', text: '**Guidelines still push back." [3]' },
        ],
      },
    ],
  };
  const [clean] = sanitizeNodes([lead], 0);
  const session = new VerdictSession({
    query: 'Does red wine help heart health?',
    results: [
      hit({
        title: 'Health effects of red wine',
        url: 'https://example.edu/wine',
        domain: 'example.edu',
        content: 'Guidelines for the prevention of cardiovascular diseases (CVD) and cancers discourage alcohol consumption in any form.',
      }),
    ],
  });
  const { node } = session.offer(clean, 0);
  const h = hero(node);
  assert.equal(h?.value, 'No');
  assert.equal(texts(node).some((t) => /^yes\b/i.test(t)), false);
  assert.equal(texts(node).some((t) => t.includes('**')), false);
  assert.equal(texts(node).some((t) => t.includes('not universal."')), false);
});

test('Q17: No tile is corrected once the body says each fruit speeds the other', () => {
  const lead: CardNode = {
    type: 'stack',
    children: [
      { type: 'hero', value: 'No', label: "Bananas don't ripen faster beside avocados", caption: "It's the avocado that speeds up — bananas are the ethylene producers [1]", tone: 'negative' },
      { type: 'stat', label: 'Ethylene source', value: 'Banana' },
    ],
  };
  const body: CardNode = {
    type: 'text',
    text: 'The effect runs both ways — bananas and avocados both emit ethylene, so each speeds the other along [1].',
  };
  const session = new VerdictSession({
    query: 'Do bananas ripen faster beside avocados?',
    results: [hit({ title: 'Ripen an avocado with a banana', url: 'https://example.com/a', domain: 'example.com', snippet: 'Bananas release ethylene, which accelerates avocado ripening.' })],
  });
  const first = session.offer(lead, 0);
  assert.equal(hero(first.node)?.value, 'No');
  const second = session.offer(body, 1);
  const revised = second.revisions.find((r) => r.index === 0);
  assert.ok(revised);
  assert.equal(hero(revised.node)?.value, 'Yes');
  assert.equal(/don't|do not|never/i.test(hero(revised.node)?.label ?? ''), false);
  assert.match(hero(revised.node)?.label ?? '', /speed/i);
  assert.ok((hero(revised.node)?.label ?? '').split(/\s+/).filter(Boolean).length <= 4, hero(revised.node)?.label);
});

test('P11: no proof stays No evidence, not a hard No or never', () => {
  const lead: CardNode = {
    type: 'hero',
    value: 'No',
    label: 'Ford never said it',
    caption: 'No firsthand evidence in any archive, book or speech',
    tone: 'negative',
  };
  const session = new VerdictSession({
    query: 'Did Henry Ford say if he asked customers they would want a faster horse?',
    results: [hit({ title: 'No proof Henry Ford said faster horses', url: 'https://www.snopes.com/ford', domain: 'snopes.com', snippet: 'No proof Henry Ford said if he had asked what customers wanted, they would have said faster horses.' })],
  });
  const { node } = session.offer(lead, 0);
  assert.equal(node.type === 'hero' && node.value, 'No evidence');
  assert.equal(node.type === 'hero' && node.label, 'No');
  assert.equal(/never|didn't|disproven|\bfalse\b/i.test(node.type === 'hero' ? `${node.value} ${node.label}` : ''), false);
});

test('a consistent No tile is left alone', () => {
  const lead: CardNode = { type: 'hero', value: 'No', label: 'The store is closed today', caption: 'The owner posted that the shop is shut on Mondays.' };
  const session = new VerdictSession({
    query: 'Is the bakery open on Monday?',
    results: [hit({ title: 'Hours', url: 'https://bakery.example/hours', domain: 'bakery.example', snippet: 'Closed Mondays.' })],
  });
  const { node, revisions } = session.offer(lead, 0);
  assert.equal(node.type === 'hero' && node.value, 'No');
  assert.equal(node.type === 'hero' && node.label, 'The store is closed today');
  assert.equal(revisions.length, 0);
});

test('a source that says constructor does not throw', () => {
  const session = new VerdictSession({
    query: 'What changed in PostgreSQL 17 MERGE?',
    results: [hit({ title: 'Release notes', url: 'https://www.postgresql.org/docs/17/release-notes.html', domain: 'postgresql.org', content: 'The constructor of the merge action was updated. No evidence of a protocol change.' })],
  });
  const { node } = session.offer({ type: 'hero', value: '17', label: 'PostgreSQL' }, 0);
  assert.equal(node.type === 'hero' && node.value, '17');
});

test('stray markdown is stripped from card text', () => {
  assert.equal(stripMarkup('**bold** still here'), 'bold still here');
  assert.equal(stripMarkup('**But the benefit is not universal."'), 'But the benefit is not universal.');
  assert.equal(stripMarkup('# Heading\nkeep'), 'Heading\nkeep');
  assert.equal(stripMarkup('use __em__ please'), 'use em please');
  const [node] = sanitizeNodes([{ type: 'text', text: '**But the benefit is not universal." [4]' }], 0);
  assert.equal(node?.type === 'text' && node.text, 'But the benefit is not universal. [4]');
});

test('P11 explicit never-said: label is No (matches the verdict), not a hard claim', () => {
  const lead: CardNode = {
    type: 'hero',
    value: 'No',
    label: 'Henry Ford never said it',
    caption: 'He never said customers would want a faster horse.',
    tone: 'negative',
  };
  const session = new VerdictSession({
    query: 'Did Henry Ford say if he asked customers they would want a faster horse?',
    results: [hit({ title: 'Quote', url: 'https://www.snopes.com/ford', domain: 'snopes.com', snippet: 'Henry Ford never said if he had asked customers they would want a faster horse.' })],
  });
  const { node } = session.offer(lead, 0);
  assert.equal(node.type === 'hero' && node.value, 'No');
  assert.equal(node.type === 'hero' && node.label, 'No');
});

test('T450: a long or server-clipped label is cut at a clause break, never mid-clause with " —…"', () => {
  const label = 'Bananas emit copious amounts of ethylene, so they nudge avocados — and each other — toward ripeness much faster than either would on its own counter';
  const session = new VerdictSession({ query: 'Do bananas ripen faster next to avocados?', results: [] });
  const out = hero(session.offer({ type: 'hero', value: 'Yes', label, tone: 'positive' }, 0).node);
  assert.ok(out?.label);
  assert.ok(out!.label!.length <= 121, out!.label);
  assert.equal(/[—,]\s*…$/.test(out!.label!), false, out!.label);
  assert.equal(out!.value, 'Yes');
  const short = hero(new VerdictSession({ query: 'q', results: [] }).offer({ type: 'hero', value: 'No', label: 'Red wine does not protect your heart', tone: 'negative' }, 0).node);
  assert.equal(short?.label, 'Red wine does not protect your heart');
});
