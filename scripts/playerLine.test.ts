import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerPageUrl, preseasonSnippet } from '../server/playerLine.ts';

const html = `
<div class="search-item"><a href="/players/c/curryst01.html">Stephen Curry (2010-2026)</a></div>
<div class="search-item"><a href="/players/t/tatumja01.html">Jayson Tatum (2018-2026)</a></div>
`;

test('the reference search link is the named player', () => {
  assert.equal(playerPageUrl(html, 'Jayson Tatum'), 'https://www.basketball-reference.com/players/t/tatumja01.html');
  assert.equal(playerPageUrl(html, 'Stephen Curry'), 'https://www.basketball-reference.com/players/c/curryst01.html');
  assert.equal(playerPageUrl(html, 'LeBron James'), undefined);
});

test('the snippet is the preseason line, not the bio', () => {
  const bio = 'Jayson Tatum Boston Celtics bio. '.repeat(400);
  const text = `${bio}${'x'.repeat(400)}10/12 Jayson Tatum scored 23 points (9-19 FG) and five rebounds in the preseason win over the 76ers.`;
  const snippet = preseasonSnippet(text, 'Jayson Tatum preseason stats');
  assert.ok(snippet);
  assert.match(snippet!, /23 points/);
  assert.match(snippet!, /five rebounds/);
  assert.equal(/bio\./.test(snippet!), false);
});
