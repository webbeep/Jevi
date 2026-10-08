import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDeadEngines, newLedger } from '../server/budget.ts';
import { cascadeWeb, searchOrder } from '../server/cascade.ts';
import { capFor, takeSlot } from '../server/providerCap.ts';
import type { Env } from '../server/util.ts';

function openUsageDb(fail = false) {
  const rows = new Map<string, number>();
  let prepares = 0;
  return {
    rows,
    get prepares() {
      return prepares;
    },
    prepare(sql: string) {
      prepares += 1;
      return {
        bind(day: unknown, provider: unknown, bucket: unknown) {
          return {
            async first() {
              if (fail) throw new Error('D1 down');
              if (!sql.includes('provider_usage')) return null;
              const key = `${String(day)}\0${String(provider)}\0${String(bucket)}`;
              const count = (rows.get(key) ?? 0) + 1;
              rows.set(key, count);
              return { count };
            },
          };
        },
      };
    },
  };
}

describe('provider daily cap', { concurrency: 1 }, () => {
  test('cap 2 refuses the third slot', async () => {
    const db = openUsageDb();
    const env = { DB: db, SERPER_DAILY_CAP: '2' } as Env;
    const now = Date.parse('2026-10-08T12:00:00.000Z');
    assert.equal(await takeSlot(env, 'serper', 'prod', now), true);
    assert.equal(await takeSlot(env, 'serper', 'prod', now), true);
    assert.equal(await takeSlot(env, 'serper', 'prod', now), false);
    assert.equal(db.rows.get('2026-10-08\0serper\0prod'), 3);
  });

  test('eval and prod buckets are separate', async () => {
    const db = openUsageDb();
    const env = { DB: db, SERPER_DAILY_CAP: '1', SERPER_EVAL_DAILY_CAP: '1' } as Env;
    const now = Date.parse('2026-10-08T12:00:00.000Z');
    assert.equal(await takeSlot(env, 'serper', 'prod', now), true);
    assert.equal(await takeSlot(env, 'serper', 'prod', now), false);
    assert.equal(await takeSlot(env, 'serper', 'eval', now), true);
    assert.equal(await takeSlot(env, 'serper', 'eval', now), false);
    assert.equal(db.rows.get('2026-10-08\0serper\0prod'), 2);
    assert.equal(db.rows.get('2026-10-08\0serper\0eval'), 2);
  });

  test('the day key is UTC', async () => {
    const db = openUsageDb();
    const env = { DB: db, SERPER_DAILY_CAP: '5' } as Env;
    assert.equal(await takeSlot(env, 'serper', 'prod', Date.parse('2026-10-08T23:30:00.000Z')), true);
    assert.equal(db.rows.has('2026-10-08\0serper\0prod'), true);
    assert.equal(await takeSlot(env, 'serper', 'prod', Date.parse('2026-10-09T00:00:00.000Z')), true);
    assert.equal(db.rows.get('2026-10-09\0serper\0prod'), 1);
    assert.equal(db.rows.get('2026-10-08\0serper\0prod'), 1);
  });

  test('D1 error refuses serper and allows an uncapped provider', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map((a) => String(a)).join(' ')); };
    try {
      const broken = openUsageDb(true);
      assert.equal(await takeSlot({ DB: broken } as Env, 'serper', 'prod'), false);
      assert.equal(await takeSlot({} as Env, 'serper', 'eval'), false);
      const before = broken.prepares;
      assert.equal(await takeSlot({ DB: broken } as Env, 'exa', 'prod'), false);
      assert.equal(await takeSlot({ DB: broken } as Env, 'tavily', 'prod'), true);
      assert.equal(await takeSlot({} as Env, 'tavily', 'prod'), true);
      assert.equal(broken.prepares, before + 1);
      assert.equal(capFor({} as Env, 'serper', 'prod'), 200);
      assert.equal(capFor({} as Env, 'serper', 'eval'), 50);
      assert.equal(capFor({} as Env, 'exa', 'prod'), 10);
      assert.equal(capFor({} as Env, 'exa', 'eval'), 0);
      assert.equal(capFor({ EXA_DAILY_CAP: 'off' } as Env, 'exa', 'prod'), undefined);
      assert.equal(logs.length, 3);
      assert.deepEqual(JSON.parse(logs[0]!), { zo: 'provider-cap', provider: 'serper', bucket: 'prod', over: true });
    } finally {
      console.log = orig;
    }
  });

  test('SEARCH_ORDER keeps known names and appends the rest in default order', () => {
    assert.deepEqual(searchOrder({} as Env), ['serper', 'langsearch', 'wikipedia', 'tavily', 'firecrawl', 'exa', 'backup']);
    assert.deepEqual(
      searchOrder({ SEARCH_ORDER: ' tavily, nope, exa, tavily, ' } as Env),
      ['tavily', 'exa', 'serper', 'langsearch', 'wikipedia', 'firecrawl', 'backup'],
    );
  });

  test('serper over the daily cap falls through with no serper fetch', async () => {
    clearDeadEngines();
    const orig = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('api.exa.ai')) {
        return Response.json({ results: [{ title: 'PostgreSQL open source database', url: 'https://www.postgresql.org/', text: 'short' }] });
      }
      return Response.json({});
    };
    try {
      const db = openUsageDb();
      const env = { DB: db, SERPER_API_KEY: 's', SERPER_DAILY_CAP: '0', EXA_DAILY_CAP: 'off', EXA_API_KEY: 'e' } as Env;
      const ledger = newLedger();
      const out = await cascadeWeb({ q: 'open source database', freshness: 'any', count: 8 }, env, ledger);
      assert.equal(out.engine, 'exa');
      assert.equal(seen.some((url) => url.includes('google.serper.dev')), false);
      assert.equal(ledger.search.serper, 0);
      assert.ok(ledger.fellThrough.includes('serper:cap-daily'));
      assert.equal(out.statuses.find((s) => s.name === 'serper')?.error, 'cap-daily');

      const capped = openUsageDb();
      let serperFetches = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('google.serper.dev')) {
          serperFetches += 1;
          return Response.json({ organic: [{ title: 'PostgreSQL open source database', link: 'https://www.postgresql.org/', snippet: 'An open source database.' }] });
        }
        return Response.json({});
      };
      const extraLedger = newLedger();
      const extra = await cascadeWeb(
        { q: 'open source database', more: ['planner rewrite'], freshness: 'any', count: 8 },
        { DB: capped, SERPER_API_KEY: 's', SERPER_DAILY_CAP: '1' } as Env,
        extraLedger,
      );
      assert.equal(extra.engine, 'serper');
      assert.equal(serperFetches, 1);
      assert.equal(extra.more.length, 0);
      assert.equal(extraLedger.search.serper, 1);
    } finally {
      globalThis.fetch = orig;
      clearDeadEngines();
    }
  });
});
