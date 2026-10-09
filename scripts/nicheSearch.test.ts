import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDeadEngines, newLedger, queriesForAsk } from '../server/budget.ts';
import { cascadeWeb } from '../server/cascade.ts';
import { askTopic, askedQuestions, isPersonAsk, personSubject, pickTopic, pickTopicQuery } from '../server/entity.ts';
import { cashtags, expandCashtags, relaxQuery, tickerQueries } from '../server/queryClean.ts';
import { gateResults } from '../server/relevanceGate.ts';
import { guessFreshness } from '../server/stream.ts';
import type { Freshness } from '../shared/types.ts';
import type { Env } from '../server/util.ts';

const hit = (title: string, snippet: string, url: string) => ({ title, url, snippet });

test('a lowercase cashtag ask keeps ticker pages that never repeat its verb (they were all dropped)', () => {
  const q = 'why $rdw dropping';
  const rows = [
    hit('Why Redwire (RDW) Stock Is Falling Today', 'Shares of Redwire slid 12% after the space company cut guidance.', 'https://www.fool.com/investing/2026/10/08/why-redwire-stock-falling/'),
    hit('RDW stock slides after earnings miss', 'Redwire Corporation (NYSE: RDW) fell in early trading.', 'https://www.marketwatch.com/story/rdw'),
    hit('Redwire Corporation (RDW) Stock Price, News, Quote', 'Find the latest Redwire Corporation (RDW) stock quote, history, news.', 'https://finance.yahoo.com/quote/RDW/'),
  ];
  const gated = gateResults(q, rows);
  assert.equal(gated.kept.length, 3);
  assert.deepEqual(cashtags('why $rdw dropping vs $NVDA'), ['rdw', 'nvda']);
  assert.deepEqual(cashtags('costs $100 or $5.99'), []);
});

test('"dropping" and "dropped" meet "drop", and "injuries" meets "injury"', () => {
  const q = 'jaylen brown injuries dropping';
  const kept = gateResults(q, [
    hit('Jaylen Brown injury update', 'Celtics forward listed as questionable with a hamstring injury.', 'https://www.nba.com/news/jaylen-brown-injury'),
    hit('Jaylen Brown dropped 30 on the Knicks', 'Brown injured his wrist late but stayed in.', 'https://www.espn.com/nba/story/brown'),
    hit('Apple pie recipe', 'A flaky crust and cinnamon apples.', 'https://example.com/pie'),
  ]).kept;
  assert.deepEqual(kept.map((r) => r.title), ['Jaylen Brown injury update', 'Jaylen Brown dropped 30 on the Knicks']);
});

test('a short lowercase surname counts as a key term', () => {
  const q = 'who is Ed chu';
  const kept = gateResults(q, [
    hit('Ed Chu, MD - Internal Medicine', 'Dr. Ed Chu is a physician in Phoenix, Arizona.', 'https://doctors.example.org/ed-chu'),
    hit('Ed Sheeran tour dates', 'Ed Sheeran announces new dates.', 'https://example.com/ed-sheeran'),
  ]).kept;
  assert.deepEqual(kept.map((r) => r.title), ['Ed Chu, MD - Internal Medicine']);
});

test('a sloppy-case person ask keeps the whole name', () => {
  assert.equal(personSubject('who is Ed chu'), 'Ed Chu');
  assert.equal(personSubject('Who is ed chu?'), 'Ed Chu');
  assert.equal(isPersonAsk('who is Ed chu'), true);
  assert.equal(personSubject('who is Messi now'), 'Messi');
  assert.equal(personSubject('who is Ray lee founder'), 'Ray Lee');
  assert.equal(personSubject('who is Barack Obama'), 'Barack Obama');
});

test('a Which-one? pick keeps the topic of the ask that offered it', () => {
  const context = 'Topic: jaylen brown injuries\nCard they are acting on (Q: jaylen brown injuries): Which one?';
  const asks = [...askedQuestions(context), 'jaylen brown injuries'];
  assert.equal(pickTopic('Jaylen Brown Boston Celtics', asks), 'injuries');
  assert.equal(pickTopicQuery('Jaylen Brown Boston Celtics', 'injuries'), 'Jaylen Brown boston celtics injuries');
  assert.equal(pickTopicQuery('Jaylen Brown Basketball Player', 'injuries'), 'Jaylen Brown basketball injuries');
  // The search stays an ask about that one person, and it is not a who-is ask.
  const q = pickTopicQuery('Jaylen Brown Boston Celtics', 'injuries');
  assert.equal(personSubject(q), 'Jaylen Brown');
  assert.equal(isPersonAsk(q), true);
  assert.notEqual(askTopic(q, 'Jaylen Brown'), '');
  // A plain who-is ask, or a pick that already says it all, adds nothing.
  assert.equal(pickTopic('Ray Lee BlueFlame AI', ['Who is Ray Lee']), '');
  assert.equal(pickTopic('Ray Lee BlueFlame AI', ['ray lee blueflame ai']), '');
  assert.equal(askTopic('Ray Lee BlueFlame AI', 'Ray Lee'), '');
  assert.equal(askTopic('Jaylen Brown injuries', 'Jaylen Brown'), 'injuries');
});

test('askedQuestions reads the conversation digest newest first', () => {
  const context = ['Topic: best running shoes', 'Earlier turns, oldest first:', '- Q: best running shoes → Top picks', '- Q: jaylen brown injuries → Which one?', 'Latest card (Q: celtics schedule): Games'].join('\n');
  assert.deepEqual(askedQuestions(context), ['celtics schedule', 'jaylen brown injuries', 'best running shoes']);
  assert.deepEqual(askedQuestions(undefined), []);
});

test('cashtags become searchable words and a model-free ticker search', () => {
  assert.equal(expandCashtags('why $rdw dropping'), 'why RDW stock dropping');
  assert.equal(expandCashtags('$rdw stock forecast'), 'RDW stock forecast');
  assert.equal(expandCashtags('best laptop under $900'), 'best laptop under $900');
  assert.equal(queriesForAsk('why $rdw dropping', []), 'why RDW stock dropping');
  assert.deepEqual(tickerQueries('why $rdw dropping'), ['RDW stock news today']);
  assert.deepEqual(tickerQueries('jaylen brown injuries'), []);
  assert.equal(relaxQuery('why $rdw dropping'), 'RDW stock');
});

test('the literal search takes its freshness from the words it has', () => {
  assert.equal(guessFreshness('celtics score tonight'), 'day');
  assert.equal(guessFreshness('jaylen brown injury news'), 'week');
  assert.equal(guessFreshness('how to boil an egg'), 'any');
});

function langHits(q: string, n: number) {
  return Response.json({
    code: 200,
    data: {
      webPages: {
        value: Array.from({ length: n }, (_, i) => ({
          name: `${q} result ${i + 1}`,
          url: `https://site${i}.example.com/${encodeURIComponent(q)}`,
          snippet: `All about ${q}, part ${i + 1}.`,
        })),
      },
    },
  });
}

const askedQuery = (init?: RequestInit) => (JSON.parse(String(init?.body ?? '{}')) as { query: string }).query;
const LANG = { LANGSEARCH_API_KEY: 'l' } as Env;

describe('cascade rewrites', { concurrency: 1 }, () => {
  test('a good literal search does not wait on a slow intent read', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('langsearch')) return Response.json({});
      const q = askedQuery(init);
      asked.push(q);
      return langHits(q, 8);
    };
    try {
      const never = new Promise<{ more: string[]; freshness: Freshness }>(() => {});
      const t0 = Date.now();
      const out = await cascadeWeb({ q: 'quark gluon plasma', later: never, freshness: 'any', count: 10 }, LANG, newLedger());
      const ms = Date.now() - t0;
      assert.equal(out.engine, 'langsearch');
      assert.equal(out.hits.length, 8);
      assert.deepEqual(asked, ['quark gluon plasma']);
      assert.ok(ms < 1600, `returned in ${ms}ms`);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test('a thin literal search waits for the rewrites, which recover the niche ask', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('langsearch')) return Response.json({});
      const q = askedQuery(init);
      if (q === 'zyx qwv') return Response.json({ code: 200, data: { webPages: { value: [{ name: 'Unrelated page', url: 'https://x.example.com/', snippet: 'Nothing here.' }] } } });
      return langHits(q, 5);
    };
    try {
      const later = new Promise<{ more: string[]; freshness: Freshness }>((r) => setTimeout(() => r({ more: ['zyx qwv company profile'], freshness: 'any' }), 200));
      const out = await cascadeWeb({ q: 'zyx qwv', later, freshness: 'any', count: 10 }, LANG, newLedger());
      assert.equal(out.more.length, 1);
      assert.equal(out.more[0]?.query, 'zyx qwv company profile');
      assert.equal(out.more[0]?.hits.length, 5);
    } finally {
      globalThis.fetch = orig;
    }
  });

  for (const literal of ['empty', 'error'] as const) {
    test(`an ${literal} literal search answers from the rewrites that already ran`, async () => {
      clearDeadEngines();
      const orig = globalThis.fetch;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).includes('langsearch')) return Response.json({});
        const q = askedQuery(init);
        if (q === 'lebron preseason debut tonight') {
          return literal === 'empty' ? Response.json({ code: 200, data: { webPages: { value: [] } } }) : new Response('boom', { status: 500 });
        }
        return langHits(q, 6);
      };
      try {
        const later = Promise.resolve({ more: ['LeBron James preseason debut', 'LeBron preseason debut how to watch'], freshness: 'any' as Freshness });
        const out = await cascadeWeb({ q: 'lebron preseason debut tonight', later, freshness: 'day', count: 10 }, LANG, newLedger());
        assert.equal(out.engine, 'langsearch');
        assert.equal(out.hits.length, 6);
        assert.equal(out.more.length, 1);
      } finally {
        globalThis.fetch = orig;
      }
    });
  }
});
