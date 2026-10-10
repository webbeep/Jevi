import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onTopicCount, rescueQuery, sourcesMiss } from '../server/rescue.ts';
import type { SourceBrief } from '../server/brief.ts';

const brief = (over: Partial<SourceBrief>): SourceBrief => ({
  goal: 'NBA preseason games and scores for October 7, 2026',
  use: [],
  stale: [],
  offTopic: [1, 2, 3],
  conflicts: [],
  missing: 'NBA preseason schedule or scores for Oct 7, 2026',
  ...over,
});

const ASK = 'What happened in Oct 7, 2026: Top 10 plays? Seven preseason games on the Oct 7 schedule.';

test('a result set that answers nothing is searched again', () => {
  assert.equal(sourcesMiss(brief({})), true);
  assert.equal(sourcesMiss(brief({ use: [1, 2], missing: 'the box score' })), false);
  assert.equal(sourcesMiss(brief({ use: [1], missing: 'the box score' })), false);
  assert.equal(sourcesMiss(brief({ missing: undefined, partial: true, offTopic: [1, 2] })), true);
  assert.equal(sourcesMiss(brief({ missing: undefined, offTopic: [] })), false);
});

test('the rescue search names the subject the question dropped', () => {
  const next = rescueQuery(ASK, brief({}));
  assert.ok(next, 'a different query');
  assert.match(next!, /\bnba\b/);
  assert.match(next!, /\b2026\b/);
  assert.doesNotMatch(next!, /top 10 plays/i);
  assert.equal(rescueQuery('NBA preseason scores October 7 2026', brief({ goal: 'NBA preseason scores October 7 2026', missing: 'NBA preseason scores' })), undefined);
});

test('on-topic rows beat a schedule from the other league', () => {
  const nfl = [
    { title: 'NFL Week 5 schedule', snippet: 'Sunday NFL games and kickoff times' },
    { title: 'Daily Top 10 Sports Plays', snippet: 'A general sports highlights video' },
  ];
  const nba = [
    { title: 'NBA preseason scores October 7', snippet: 'Seven preseason games and the top plays' },
    { title: 'NFL Week 5 schedule', snippet: 'Sunday NFL games' },
  ];
  const judged = brief({});
  assert.equal(onTopicCount(nfl, judged), 0);
  assert.ok(onTopicCount(nba, judged) > onTopicCount(nfl, judged));
});
