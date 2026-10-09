import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askQuestion, cleanRef, entityOf, refContext, withRef, REF_MAX, type Box } from '../shared/askAbout.ts';

const cases: [Box, string][] = [
  // tile: label + value + entity (the t453 repro)
  [{ kind: 'tile', label: 'Agent', value: 'AMP', entity: 'BlueFlame AI' }, "What is AMP, BlueFlame AI's agent?"],
  [{ kind: 'tile', label: 'Agent', value: 'AMP' }, 'What is the agent AMP?'],
  [{ kind: 'tile', value: 'AMP', entity: 'BlueFlame AI' }, 'What is AMP at BlueFlame AI?'],
  [{ kind: 'tile', value: 'AMP' }, 'What is AMP?'],
  [{ kind: 'tile', label: 'Pricing', entity: 'BlueFlame AI' }, "What is BlueFlame AI's pricing?"],
  [{ kind: 'tile', label: 'Pricing' }, 'What is Pricing?'],
  // numeric stats
  [{ kind: 'stat', label: 'Revenue growth', value: '42', unit: '%', entity: 'BlueFlame AI' }, "What is behind BlueFlame AI's 42% revenue growth?"],
  [{ kind: 'stat', label: 'Revenue growth', value: '42%' }, 'What is behind the 42% revenue growth?'],
  [{ kind: 'stat', label: 'Points per game', value: '28.4', entity: 'Stephen Curry' }, "What is behind Stephen Curry's 28.4 points per game?"],
  [{ kind: 'stat', value: '$1.2B', entity: 'BlueFlame AI' }, "What is behind BlueFlame AI's $1.2B?"],
  // a name in the label, a stat in the value
  [{ kind: 'tile', label: 'Steph', value: '10 pts', entity: '2026 NBA preseason' }, "What is behind Steph's 10 pts?"],
  [{ kind: 'tile', label: 'Lendeborg', value: 'Warriors' }, 'What about Lendeborg (Warriors)?'],
  // people
  [{ kind: 'tile', label: 'CEO', value: 'Raj Bhatt', entity: 'BlueFlame AI' }, "Who is Raj Bhatt, BlueFlame AI's CEO?"],
  [{ kind: 'tile', label: 'Founded by', value: 'Raj Bhatt and Ann Lee', entity: 'BlueFlame AI' }, "Who are Raj Bhatt and Ann Lee, BlueFlame AI's founders?"],
  [{ kind: 'tile', label: 'Head coach', value: 'Steve Kerr' }, 'Who is Steve Kerr, the head coach?'],
  [{ kind: 'tile', label: 'CEO', value: 'Raj Bhatt', entity: 'Warriors' }, "Who is Raj Bhatt, Warriors' CEO?"],
  // a company in a role a company can fill
  [{ kind: 'fact', label: 'Owner', value: 'Datasite', entity: 'BlueFlame AI' }, "What is Datasite, BlueFlame AI's owner?"],
  [{ kind: 'fact', label: 'Owned by', value: 'Datasite', entity: 'BlueFlame AI' }, "What is Datasite, BlueFlame AI's owner?"],
  [{ kind: 'fact', label: 'Owner', value: 'Joe Lacob', entity: 'Warriors' }, "Who is Joe Lacob, Warriors' owner?"],
  [{ kind: 'tile', label: 'Founded by', value: 'Y Combinator Labs', entity: 'Acme' }, "What is Y Combinator Labs, Acme's founder?"],
  // profile facts and kinds
  [{ kind: 'fact', label: 'Role', value: 'Senior Software Engineer', entity: 'Ray Lee' }, "What does Ray Lee's role as Senior Software Engineer involve?"],
  [{ kind: 'fact', label: 'Location', value: 'New York, NY', entity: 'Ray Lee' }, "What is Ray Lee's connection to New York, NY?"],
  [{ kind: 'fact', label: 'Education', value: 'The Cooper Union', entity: 'Ray Lee' }, 'What did Ray Lee study at The Cooper Union?'],
  [{ kind: 'fact', label: 'Company', value: 'Stripe', entity: 'Ray Lee' }, 'What does Ray Lee do at Stripe?'],
  [{ kind: 'tile', label: 'Company', value: 'BlueFlame AI', entity: 'BlueFlame AI' }, 'What is BlueFlame AI?'],
  [{ kind: 'tile', label: 'Founded', value: '2019', entity: 'BlueFlame AI' }, 'How was BlueFlame AI founded in 2019?'],
  [{ kind: 'tile', label: 'Series A', value: '2024', entity: 'BlueFlame AI' }, 'What happened with Series A in 2024?'],
  [{ kind: 'tile', label: 'Last funding', value: 'Mar 2024', entity: 'BlueFlame AI' }, 'What happened with BlueFlame AI in Mar 2024?'],
  [{ kind: 'profile', label: 'Ray Lee', value: 'Software engineer at Stripe' }, 'Who is Ray Lee, software engineer at Stripe?'],
  [{ kind: 'profile', label: 'Ray Lee' }, 'Who is Ray Lee?'],
  // verdicts
  [{ kind: 'verdict', label: 'Do bananas ripen avocados faster when stored in a paper bag', value: 'Yes' }, 'Why do bananas ripen avocados faster when stored in a paper bag?'],
  [{ kind: 'verdict', label: 'Is coffee bad for you?', value: 'No' }, "Why isn't coffee bad for you?"],
  [{ kind: 'verdict', label: 'Can dogs eat grapes', value: 'Depends' }, 'When can dogs eat grapes?'],
  [{ kind: 'tile', label: 'Bananas ripen avocados', value: 'True' }, 'Why is it true that bananas ripen avocados?'],
  [{ kind: 'tile', label: 'Bananas ripen avocados', value: 'False' }, 'Why is it false that bananas ripen avocados?'],
  [{ kind: 'tile', label: 'Avocados ripen bananas', value: 'Mixed' }, 'How true is it that avocados ripen bananas?'],
  [{ kind: 'tile', label: 'Stephen Curry retired', value: 'No' }, 'Why is it false that Stephen Curry retired?'],
  // rows, lists, links, timeline
  [{ kind: 'row', label: '**Yaxel Lendeborg** — Warriors forward' }, 'Who is Yaxel Lendeborg?'],
  [{ kind: 'row', label: 'Yaxel Lendeborg, Golden State Warriors', detail: 'Top rookie' }, 'Who is Yaxel Lendeborg?'],
  [{ kind: 'row', label: 'Paris, France' }, 'What is Paris, France?'],
  [{ kind: 'row', label: 'AMP — research and diligence agent', entity: 'BlueFlame AI' }, 'What is AMP?'],
  [{ kind: 'list', label: 'Clifford scored 18 off the bench in every preseason game so far [3]' }, 'Explain "Clifford scored 18 off the bench in every preseason game so far"'],
  [{ kind: 'link', label: 'ESPN preseason tracker' }, 'What is ESPN preseason tracker?'],
  [{ kind: 'timeline', label: 'Series A', when: '2024' }, 'What happened in 2024: Series A?'],
  // T453 ship: game tiles on sports cards
  [{ kind: 'tile', label: 'vs Trail Blazers', value: 'L 118-123' }, 'What happened in the game vs Trail Blazers (L 118-123)?'],
  [{ kind: 'tile', label: 'vs LA Clippers', value: 'Upcoming' }, 'What should I know about the game vs LA Clippers?'],
  [{ kind: 'tile', label: 'Raised', value: '$5M', entity: 'Blueflame AI' }, "What is behind Blueflame AI's $5M raised?"],
  [{ kind: 'tile', label: '@ Lakers', value: 'W 112-104', entity: 'Golden State Warriors' }, "What happened in Golden State Warriors' game at Lakers (W 112-104)?"],
  [{ kind: 'timeline', label: 'Series A' }, 'What is Series A?'],
  // nothing usable
  [{ kind: 'tile' }, 'What is this?'],
  [{ kind: 'profile' }, 'What is this?'],
];

for (const [box, want] of cases) {
  test(`${box.kind}: ${JSON.stringify([box.label, box.value, box.entity])} -> ${want}`, () => assert.equal(askQuestion(box), want));
}

test('no box ever asks "Ask about …" or "Tell me more", and questions stay short', () => {
  for (const [box] of cases) {
    const q = askQuestion(box);
    assert.doesNotMatch(q, /^(ask about|tell me more)/i);
    assert.ok(q.length <= 220, q);
  }
  const long = askQuestion({ kind: 'tile', label: 'Agent', value: 'x'.repeat(500), entity: 'y'.repeat(500) });
  assert.ok(long.length <= 220, long);
});

test('a sentence-long label asks about the value', () => {
  assert.equal(askQuestion({ kind: 'tile', label: 'Flagship product for alternative investment managers and family offices', value: 'Agentic Management Platform', entity: 'BlueFlame AI' }), 'What is Agentic Management Platform at BlueFlame AI?');
});

test('entityOf takes the subject of a card title', () => {
  assert.equal(entityOf('BlueFlame AI'), 'BlueFlame AI');
  assert.equal(entityOf('What is BlueFlame AI?'), 'BlueFlame AI');
  assert.equal(entityOf('Who is Ray Lee'), 'Ray Lee');
  assert.equal(entityOf('Warriors Preseason 2026 Results'), undefined);
  assert.equal(entityOf('NBA Scores Tonight'), undefined);
  assert.equal(entityOf('iPhone 17 Pro'), 'iPhone 17 Pro');
  assert.equal(entityOf('BlueFlame AI — agents for alternative investments'), 'BlueFlame AI');
  assert.equal(entityOf('BlueFlame AI: agents for funds'), 'BlueFlame AI');
  assert.equal(entityOf('BlueFlame AI (company)'), 'BlueFlame AI');
  assert.equal(entityOf(''), undefined);
  assert.equal(entityOf(undefined), undefined);
  assert.equal(entityOf('x'.repeat(81)), undefined);
  assert.equal(entityOf('Bank of America'), 'Bank of America');
  assert.equal(entityOf('NBA Preseason fixture'), undefined, 'T453 ship: season/topic words make it a topic');
  // topic titles are not entities
  assert.equal(entityOf('Best apples for apple pie'), undefined);
  assert.equal(entityOf('2026 NBA preseason'), undefined);
  assert.equal(entityOf('Top rookies this preseason'), undefined);
  assert.equal(entityOf('How to ripen avocados'), undefined);
  assert.equal(entityOf('Apples that hold their shape in pies'), undefined);
});

test('cleanRef trims, caps at 300, keeps https only, drops junk', () => {
  assert.deepEqual(cleanRef({ label: '  Agent ', value: 'AMP', entity: ' BlueFlame  AI ', sourceUrl: 'https://blueflame.ai/amp', snippet: ' s ', extra: 'x' }), { label: 'Agent', value: 'AMP', entity: 'BlueFlame AI', snippet: 's', sourceUrl: 'https://blueflame.ai/amp' });
  const big = cleanRef({ label: 'a'.repeat(1000), snippet: 'b'.repeat(1000) });
  assert.equal(big?.label?.length, REF_MAX);
  assert.equal(big?.snippet?.length, REF_MAX);
  assert.equal(cleanRef({ label: 'A', sourceUrl: 'http://example.com' })?.sourceUrl, undefined);
  assert.equal(cleanRef({ label: 'A', sourceUrl: 'javascript:alert(1)' })?.sourceUrl, undefined);
  assert.equal(cleanRef({ label: 'A', sourceUrl: 'not a url' })?.sourceUrl, undefined);
  assert.equal(cleanRef({ label: 'A', sourceUrl: `https://x.com/${'a'.repeat(400)}` })?.sourceUrl, undefined);
  assert.equal(cleanRef({ label: 3, value: { x: 1 } }), undefined);
  assert.equal(cleanRef({ entity: 'BlueFlame AI', snippet: 's' }), undefined);
  assert.equal(cleanRef('Agent'), undefined);
  assert.equal(cleanRef(null), undefined);
  assert.equal(cleanRef([{ label: 'A' }]), undefined);
  assert.deepEqual(cleanRef({ value: ' 42% ' }), { value: '42%' });
});

test('refContext names the tapped thing, its entity, snippet and host', () => {
  assert.equal(
    refContext({ label: 'Agent', value: 'AMP', entity: 'BlueFlame AI', snippet: 'AMP automates diligence.', sourceUrl: 'https://www.blueflame.ai/amp' }),
    'Tapped on the card: Agent: AMP (about BlueFlame AI)\nSource snippet: AMP automates diligence.\nSource: blueflame.ai',
  );
  assert.equal(refContext({ value: 'AMP' }), 'Tapped on the card: AMP');
});

test('withRef keeps the tapped thing and entity in the search query', () => {
  assert.equal(withRef('BlueFlame AI agent', { label: 'Agent', value: 'AMP', entity: 'BlueFlame AI' }), 'BlueFlame AI agent AMP');
  assert.equal(withRef('what is AMP', { label: 'Agent', value: 'AMP', entity: 'BlueFlame AI' }), 'what is AMP BlueFlame AI');
  assert.equal(withRef('AMP BlueFlame AI agent', { value: 'AMP', entity: 'BlueFlame AI' }), 'AMP BlueFlame AI agent');
  assert.equal(withRef('pricing', { label: 'Pricing' }), 'pricing');
  assert.equal(withRef('q', undefined), 'q');
});
