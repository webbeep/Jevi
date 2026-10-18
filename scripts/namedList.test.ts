import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { cardCitesName, citedNames, nameSeekingQuery, namedListNode, wantsNamedList } from '../server/namedList.ts';

const ASK = 'NBA Fantasy preseason standouts with high score upside 2026 sleepers';

test('a request for named things is not a comparison or a single who-is', () => {
  assert.equal(wantsNamedList(ASK), true);
  assert.equal(wantsNamedList('Who are the breakout rookies in the Premier League this season'), true);
  assert.equal(wantsNamedList('Which albums are the sleeper picks this year'), true);
  assert.equal(wantsNamedList('Pentax KF versus Fujifilm X-T30 II'), false);
  assert.equal(wantsNamedList('Who is Taylor Swift'), false);
});

test('a checklist is not a name, and a source name is', () => {
  assert.deepEqual(citedNames(ASK, ['High usage and volume. Sleepers flagged before the season.']), []);
  assert.deepEqual(citedNames(ASK, ['Jalen Johnson is a preseason standout averaging 18 points.']), ['Jalen Johnson']);
});

test('the next search asks for names, not what to look for', () => {
  assert.equal(nameSeekingQuery(ASK, 'what to look for in fantasy sleepers'), `${ASK} names`);
  assert.equal(nameSeekingQuery(ASK, '2026 fantasy basketball sleeper players'), '2026 fantasy basketball sleeper players');
});

test('a card that never cites a name lists the names the sources stated', () => {
  const tips: CardNode[] = [{ type: 'text', text: 'Look for high usage, volume, and sleepers flagged before the season.' }];
  const results = [
    { title: 'Preseason standouts', snippet: 'Jalen Johnson is the sleeper, averaging 18 points.' },
    { title: 'More names', snippet: 'Brandin Podziemski fits the upside case with 16 points.' },
  ];
  assert.equal(cardCitesName(ASK, tips, results), false);
  const node = namedListNode(ASK, results);
  assert.equal(node.type, 'list');
  if (node.type !== 'list') return;
  assert.deepEqual(node.items.map((item) => item.text), ['Jalen Johnson', 'Brandin Podziemski']);
  assert.equal(node.items[0]?.source, 1);
  assert.match(node.items[0]?.meta ?? '', /18 points/);
  const named: CardNode[] = [{ type: 'tile', label: 'Jalen Johnson', value: '18 points' }];
  assert.equal(cardCitesName(ASK, named, results), true);
});

test('when the sources name nobody, the card says so', () => {
  const node = namedListNode(ASK, [{ title: 'Fantasy tips', snippet: 'Look for high usage and volume before the season.' }]);
  assert.equal(node.type, 'callout');
  assert.equal(node.type === 'callout' ? node.text : '', 'The sources named none.');
});
