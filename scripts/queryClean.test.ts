import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entityQuery, relaxQuery, sanitizeSearchQuery } from '../server/queryClean.ts';

const NIQU = 'Nique Clifford Sacramento Kings preseason standout sactownsports.com';

test('sanitize drops domains and a trailing card title, and keeps site filters', () => {
  assert.equal(sanitizeSearchQuery(NIQU), 'Nique Clifford Sacramento Kings preseason standout');
  assert.equal(sanitizeSearchQuery('Nique Clifford https://www.espn.com/nba nba.com/kings'), 'Nique Clifford');
  assert.equal(sanitizeSearchQuery('apple varieties Apple Pie Recipe', 'Apple Pie Recipe'), 'apple varieties');
  assert.equal(sanitizeSearchQuery('Kings news sactownsports', 'Preview — sactownsports.com'), 'Kings news');
  assert.equal(sanitizeSearchQuery('site:espn.com Nique Clifford www.espn.com'), 'site:espn.com Nique Clifford');
  assert.equal(sanitizeSearchQuery('Nique Clifford.'), 'Nique Clifford');
  assert.equal(sanitizeSearchQuery('sactownsports.com'), 'sactownsports.com');
  assert.equal(sanitizeSearchQuery('Who is Datasite, owner of Blueflame AI Blueflame AI at Datasite'), 'Who is Datasite, owner of Blueflame AI at Datasite');
  assert.equal(sanitizeSearchQuery('Walla Walla wineries'), 'Walla Walla wineries');
});

test('relax keeps the entity and entityQuery takes the leading capitalized run', () => {
  assert.match(relaxQuery(NIQU), /Nique Clifford Sacramento Kings/);
  assert.equal(relaxQuery('site:espn.com "Nique Clifford" (standout)'), 'Nique Clifford');
  assert.equal(relaxQuery('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta'), 'Alpha Beta Gamma Delta Epsilon Zeta');
  assert.equal(entityQuery(NIQU), 'Nique Clifford Sacramento Kings');
  assert.equal(entityQuery('Who is Datasite, owner of Blueflame AI'), 'Datasite');
  assert.equal(entityQuery('Alpha Beta Gamma Delta Epsilon'), 'Alpha Beta Gamma Delta');
  assert.equal(entityQuery('preseason standout'), '');
});
