import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnswerCard } from '../shared/card.ts';
import { packHistoryPayload, packHistorySources, unpackHistoryPayload } from '../shared/historyCard.ts';

const card = { title: 'NBA', body: [{ type: 'video', source: 3 }] } as AnswerCard;

test('packed sources keep their numbers so a later video still lines up', () => {
  const packed = packHistorySources([
    { title: '', url: '' },
    { title: 'Box score', url: 'https://www.nba.com/game', snippet: 'x'.repeat(400), content: 'full page' },
    { title: 'Rockets at Mavericks', url: 'https://www.youtube.com/watch?v=abc123', image: 'https://i.ytimg.com/vi/abc123/0.jpg' },
  ]);
  assert.equal(packed.length, 3);
  assert.equal(packed[2]?.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(packed[1]?.snippet.length, 220);
  assert.equal('content' in (packed[1] ?? {}), false);
  assert.equal(packed[2]?.image, 'https://i.ytimg.com/vi/abc123/0.jpg');

  const round = unpackHistoryPayload(packHistoryPayload(card, packed));
  assert.equal(round.card?.title, 'NBA');
  assert.equal(round.results[2]?.url, 'https://www.youtube.com/watch?v=abc123');
});

test('an older bare card still opens, without sources', () => {
  const round = unpackHistoryPayload(card);
  assert.equal(round.card?.title, 'NBA');
  assert.deepEqual(round.results, []);
  assert.deepEqual(unpackHistoryPayload(null), { card: null, results: [] });
});
