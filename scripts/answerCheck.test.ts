import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readBrief, rejectedSources } from '../server/brief.ts';
import { readReview } from '../server/review.ts';
import { corpusOf, gateNode, type DesignRequest } from '../server/design.ts';
import { Grounding } from '../server/ground.ts';

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
