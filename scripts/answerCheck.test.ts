import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readBrief, rejectedSources, remapBrief } from '../server/brief.ts';
import { keepPictures, readReview } from '../server/review.ts';
import { corpusOf, gateNode, type DesignRequest } from '../server/design.ts';
import { Grounding } from '../server/ground.ts';
import { tickerBody } from '../shared/tickerNotes.ts';
import type { CardNode } from '../shared/card.ts';

describe('source brief', () => {
  test('keeps valid source numbers and drops overlaps', () => {
    const brief = readBrief({ goal: 'Bitcoin current USD price', use: [1, 2, 99], stale: [3, 2, 4], offTopic: [5, 1], conflicts: ['[3] says 71,360 on Jun 2; [1] says 82,290'], missing: '' }, 6);
    assert.deepEqual(brief, { goal: 'Bitcoin current USD price', use: [1, 2], stale: [3, 4], offTopic: [5], conflicts: ['[3] says 71,360 on Jun 2; [1] says 82,290'], missing: undefined });
  });

  test('no goal, no brief', () => {
    assert.equal(readBrief({ use: [1] }, 3), undefined);
    assert.equal(readBrief(undefined, 3), undefined);
  });

  test('never rejects every source', () => {
    assert.deepEqual([...rejectedSources({ goal: 'g', use: [], stale: [1, 2], offTopic: [3], conflicts: [] }, 3)], []);
    assert.deepEqual([...rejectedSources({ goal: 'g', use: [1], stale: [2], offTopic: [3], conflicts: [] }, 3)].sort(), [2, 3]);
  });

  test('numbers from outdated sources cannot reach the card', () => {
    const req = {
      query: 'Btc Usd',
      pattern: 'answer',
      depth: 'brief',
      pages: [],
      search: {
        query: 'Btc Usd',
        freshness: 'any',
        results: [
          { title: 'Bitcoin live price', url: 'https://finance.yahoo.com/quote/BTC-USD', snippet: 'Live price: 82,290.94 USD', domain: 'finance.yahoo.com', engines: ['quote'] },
          { title: 'Bitcoin hits all-time high', url: 'https://example.com/ath', snippet: 'BTC reached 71,360.33 on June 2', domain: 'example.com', engines: ['serper'] },
        ],
        images: [],
        engines: [],
      },
      brief: { goal: 'current price', use: [1], stale: [2], offTopic: [], conflicts: [] },
    } as unknown as DesignRequest;
    const g = new Grounding(corpusOf(req));
    assert.ok(g.ok('82,290.94'));
    assert.ok(!g.ok('71,360.33'));
    const unbriefed = new Grounding(corpusOf({ ...req, brief: undefined }));
    assert.ok(unbriefed.ok('71,360.33'));
  });
});

describe('answer review', () => {
  const shown = new Set([0, 1, 4]);

  test('ok verdict carries no changes', () => {
    assert.deepEqual(readReview({ verdict: 'ok', problems: [], fixes: [], note: '' }, shown), { ok: true, problems: [], fixes: [], note: undefined });
  });

  test('fixes only target nodes on the card', () => {
    const review = readReview({
      verdict: 'fix',
      problems: ['Node 0 shows a June price as current'],
      fixes: [{ node: 0, replace: { type: 'hero', value: '82,290.94' } }, { node: 7, replace: { type: 'text', text: 'x' } }, { node: 1 }],
      note: '',
    }, shown);
    assert.equal(review?.ok, false);
    assert.deepEqual(review?.fixes, [{ index: 0, node: { type: 'hero', value: '82,290.94' } }]);
  });

  test('a fix verdict with nothing to apply counts as ok', () => {
    assert.equal(readReview({ verdict: 'fix', problems: ['minor'], fixes: [], note: '' }, shown)?.ok, true);
  });

  test('remarks about the card itself never reach the reader', () => {
    const fix = [{ node: 1, replace: { type: 'text', text: 'Sony WH-CH720N, $98 [2]' } }];
    assert.equal(readReview({ verdict: 'fix', problems: ['Node 1 lists premium models'], fixes: fix, note: 'The card mixes budget and premium models.' }, shown)?.note, undefined);
    assert.equal(readReview({ verdict: 'fix', problems: ['Node 0 price is from June'], fixes: [], note: 'No result gives a price from today.' }, shown)?.note, 'No result gives a price from today.');
  });

  test('a false-premise follow-up is replaced', () => {
    const review = readReview({ verdict: 'fix', problems: ['Follow-up 2 says Bitcoin dropped 17% today; the card shows -0.4%'], fixes: [], note: '', followups: ['What moved Bitcoin this week?', ' ', 42, 'What is the 52-week range?'] }, shown);
    assert.equal(review?.ok, false);
    assert.deepEqual(review?.followups, ['What moved Bitcoin this week?', 'What is the 52-week range?']);
    assert.equal(readReview({ verdict: 'ok', problems: [], fixes: [], note: '', followups: ['x'] }, shown)?.followups, undefined);
  });

  test('unreadable replies are ignored', () => {
    assert.equal(readReview({ verdict: 'maybe' }, shown), undefined);
    assert.equal(readReview(undefined, shown), undefined);
  });
});

describe('ticker cards', () => {
  const req = {
    query: 'Btc Usd',
    pattern: 'answer',
    depth: 'brief',
    pages: [],
    search: { query: 'Btc Usd', freshness: 'any', results: [{ title: 'Bitcoin live price', url: 'https://finance.yahoo.com/quote/BTC-USD', snippet: 'Live price: 82,290.94 USD; day range 81,602.41–83,259.63', domain: 'finance.yahoo.com', engines: ['quote'] }], images: [], engines: [] },
    ticker: { type: 'ticker', symbol: 'BTC-USD', name: 'Bitcoin', kind: 'crypto', currency: 'USD', feed: 'Yahoo Finance', series: { range: '1D', points: [[1, 1], [2, 2]], base: 1, price: 2, at: '' } },
  } as unknown as DesignRequest;

  test('a note that the chart is missing never reaches the card', () => {
    assert.equal(gateNode({ type: 'callout', title: 'No chart image available', text: 'Sources give only a live price snapshot — no accessible BTC/USD chart data.' }, req), undefined);
    assert.equal(gateNode({ type: 'chart', kind: 'line', data: [{ label: 'a', value: 82290.94 }, { label: 'b', value: 81602.41 }] }, req), undefined);
  });

  test('other notes stay', () => {
    assert.ok(gateNode({ type: 'callout', text: 'Crypto trades around the clock, so the day range covers a rolling day.' }, req));
  });
});

describe('saved ticker cards', () => {
  test('the old "no chart" note is hidden beside the live chart', () => {
    const ticker = { type: 'ticker', symbol: 'BTC-USD', name: 'Bitcoin', kind: 'crypto', currency: 'USD', feed: 'Yahoo Finance', series: { range: '1D', points: [[1, 1], [2, 2]], base: 1, price: 2, at: '' } } as const;
    const note = { type: 'callout', title: 'No chart image available', text: 'Sources give only a live price snapshot with day and 52-week ranges — no accessible BTC/USD chart data.' } as const;
    const tiles = { type: 'grid', cols: 2, children: [{ type: 'tile', label: 'Day range', value: '81,602–83,259' }] } as const;
    const body = tickerBody([ticker, note, tiles] as unknown as CardNode[]);
    assert.deepEqual(body.map((n) => n.type), ['ticker', 'grid']);
  });

  test('cards without a ticker are untouched', () => {
    const body = [{ type: 'callout', text: 'No chart is available for this.' }] as unknown as CardNode[];
    assert.equal(tickerBody(body), body);
  });
});

describe('review fixes keep pictures', () => {
  test('a corrected grid keeps the pictures placed on its tiles', () => {
    const before = { type: 'grid', cols: 2, children: [
      { type: 'tile', label: 'iPhone 17', value: '$829', imageSrc: 'https://img/a.jpg' },
      { type: 'tile', label: 'Pixel 10', value: '$799', imageRef: 2 },
    ] };
    const after = { type: 'grid', cols: 2, children: [
      { type: 'tile', label: 'iPhone 17', value: '$799', imageQuery: 'iPhone 17' },
      { type: 'tile', label: 'Pixel 10', value: '$699', imageRef: 0 },
    ] };
    assert.deepEqual(keepPictures(before, after), { type: 'grid', cols: 2, children: [
      { type: 'tile', label: 'iPhone 17', value: '$799', imageSrc: 'https://img/a.jpg', imageRef: undefined, imageQuery: undefined },
      { type: 'tile', label: 'Pixel 10', value: '$699', imageRef: 0 },
    ] });
  });

  test('a node of another type takes nothing', () => {
    const after = { type: 'text', text: 'x' };
    assert.equal(keepPictures({ type: 'profile', name: 'A', imageSrc: 'u' }, after), after);
  });

  test('a corrected profile keeps its website link', () => {
    assert.deepEqual(keepPictures({ type: 'profile', name: 'A', website: 2 }, { type: 'profile', name: 'A B' }), { type: 'profile', name: 'A B', website: 2 });
  });
});

describe('early source check', () => {
  const row = (url: string) => ({ title: url, url: `https://${url}`, snippet: '', domain: url, engines: ['web'] });

  test('renumbers onto the final rows and marks rows it never saw', () => {
    const judged = [row('a.com/1'), row('b.com/2'), row('c.com/3')];
    const final = [row('x.com/new'), row('c.com/3'), row('a.com/1'), row('b.com/2')];
    const brief = { goal: 'g', use: [1, 3], stale: [2], offTopic: [], conflicts: ['[1] says 5; [2] says 6'], missing: 'today\'s price' };
    assert.deepEqual(remapBrief(brief, judged, final), { goal: 'g', use: [3, 2], stale: [4], offTopic: [], conflicts: ['[3] says 5; [4] says 6'], missing: undefined, partial: true });
  });

  test('the same rows keep everything', () => {
    const judged = [row('a.com'), row('b.com')];
    const brief = { goal: 'g', use: [2], stale: [], offTopic: [1], conflicts: [], missing: 'x' };
    assert.deepEqual(remapBrief(brief, judged, [judged[1]!, judged[0]!]), { goal: 'g', use: [1], stale: [], offTopic: [2], conflicts: [], missing: 'x' });
  });
});
