import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleHistoryCard, handleHistoryDelete, handleHistoryItem, handleHistoryList, handleHistoryTouch, handleHistoryTouchQuery, recordAsk } from '../server/auth/history.ts';
import { signSessionToken } from '../server/auth/session.ts';
import type { Env } from '../server/util.ts';

const SECRET = 'test-session-secret-32chars!!';

function mem() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, isAnonymous INTEGER,
      createdAt TEXT, updatedAt TEXT, emailVerified INTEGER
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY, token TEXT, userId TEXT, expiresAt TEXT, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE ask_history (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      card_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const d1 = {
    prepare(sql: string) {
      const order: number[] = [];
      const positional = sql.replace(/\?(\d+)/g, (_match, n: string) => {
        order.push(Number(n));
        return '?';
      });
      return {
        bind(...args: unknown[]) {
          const values = order.length ? order.map((n) => args[n - 1]) : args;
          return {
            async first() {
              return db.prepare(positional).get(...(values as [])) ?? null;
            },
            async all() {
              return { results: db.prepare(positional).all(...(values as [])) };
            },
            async run() {
              const result = db.prepare(positional).run(...(values as []));
              return { success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
  };
  return { db, env: { DB: d1, SESSION_SECRET: SECRET, AUTH_ENABLED: 'true' } as unknown as Env };
}

async function signIn(db: DatabaseSync, id: string): Promise<string> {
  const token = `tok-${id}`;
  db.prepare(`INSERT INTO user (id, name, email, image, isAnonymous, createdAt, updatedAt) VALUES (?, ?, ?, NULL, 0, '2026-10-01', '2026-10-01')`).run(id, id, `${id}@e.x`);
  db.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', '2026-10-01', '2026-10-01')`).run(`s-${id}`, token, id);
  return `zo_sess=${await signSessionToken(token, SECRET)}`;
}

test('a reopened question moves ahead and comes back with its video source', async () => {
  const { db, env } = mem();
  const cookie = await signIn(db, 'user-a');
  const other = await signIn(db, 'user-b');
  const firstAt = new Date('2026-10-09T18:00:00.000Z');
  await recordAsk(env, 'user-a', 'nba highlights yesterday', 'search', firstAt);
  await recordAsk(env, 'user-a', 'weather', 'search', new Date(firstAt.getTime() + 120_000));

  const listed = await handleHistoryList(new Request('http://127.0.0.1/api/history', { headers: { cookie } }), env);
  const before = (await listed.json()) as { items: { id: string; query: string }[] };
  assert.deepEqual(before.items.map((item) => item.query), ['weather', 'nba highlights yesterday']);

  const saved = await handleHistoryCard(
    new Request('http://127.0.0.1/api/history/card', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'nba highlights yesterday',
        card: { title: 'Nba Game Highlights Yesterday', body: [{ type: 'video', source: 3 }] },
        results: [
          { title: '', url: '' },
          { title: 'Box', url: 'https://www.nba.com/game', content: 'page text that should not be stored' },
          { title: 'Rockets at Mavericks', url: 'https://www.youtube.com/watch?v=abc123' },
        ],
      }),
    }),
    env,
    new Date(firstAt.getTime() + 10_000),
  );
  assert.equal(saved.status, 200);

  const opened = await handleHistoryTouchQuery(
    new Request('http://127.0.0.1/api/history/touch', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'NBA Highlights Yesterday' }),
    }),
    env,
    new Date('2026-10-10T16:00:00.000Z'),
  );
  assert.equal(opened.status, 200);
  const payload = (await opened.json()) as { moved: boolean; card: { title: string }; results: { url: string }[] };
  assert.equal(payload.moved, true);
  assert.equal(payload.card.title, 'Nba Game Highlights Yesterday');
  assert.equal(payload.results[2]?.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(payload.results[1]?.url, 'https://www.nba.com/game');

  const after = await handleHistoryList(new Request('http://127.0.0.1/api/history', { headers: { cookie } }), env);
  const rows = (await after.json()) as { items: { id: string; query: string }[] };
  assert.deepEqual(rows.items.map((item) => item.query), ['nba highlights yesterday', 'weather']);

  const item = await handleHistoryItem(new Request(`http://127.0.0.1/api/history/${rows.items[0]?.id}`, { headers: { cookie } }), env, rows.items[0]?.id ?? '');
  const detail = (await item.json()) as { results: { url: string; content?: string }[] };
  assert.equal(detail.results[2]?.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(detail.results[1]?.content, undefined);

  const stolen = await handleHistoryTouch(
    new Request('http://127.0.0.1/api/history/x', { method: 'POST', headers: { cookie: other } }),
    env,
    rows.items[0]?.id ?? '',
  );
  assert.equal(stolen.status, 200);
  assert.equal(((await stolen.json()) as { moved: boolean }).moved, false);

  const cleared = await handleHistoryDelete(new Request('http://127.0.0.1/api/history', { method: 'DELETE', headers: { cookie } }), env);
  assert.equal(cleared.status, 200);
  const left = db.prepare(`SELECT COUNT(*) AS n FROM ask_history WHERE user_id = 'user-a'`).get() as { n: number };
  assert.equal(left.n, 0);
});
