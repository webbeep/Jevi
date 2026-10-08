import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleSaveCollection, handleSaveItem } from '../server/auth/saves.ts';
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
    CREATE TABLE usage (
      day TEXT NOT NULL, subject_key TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, subject_key)
    );
    CREATE TABLE saved_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      card_json TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, query_hash)
    );
  `);
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return db.prepare(sql).get(...(args as [])) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...(args as [])) };
            },
            async run() {
              const result = db.prepare(sql).run(...(args as []));
              return { success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
  };
  return { db, env: { DB: d1, SESSION_SECRET: SECRET, AUTH_ENABLED: 'true', GATE_ANON_PER_DAY: '5' } as unknown as Env };
}

async function signIn(db: DatabaseSync, id: string, anonymous = false): Promise<string> {
  const token = `tok-${id}`;
  db.prepare(`INSERT INTO user (id, name, email, image, isAnonymous, createdAt, updatedAt) VALUES (?, ?, ?, NULL, ?, '2026-10-01', '2026-10-01')`).run(
    id,
    id,
    `${id}@e.x`,
    anonymous ? 1 : 0,
  );
  db.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', '2026-10-01', '2026-10-01')`).run(
    `s-${id}`,
    token,
    id,
  );
  return `zo_sess=${await signSessionToken(token, SECRET)}`;
}

function post(cookie: string, body: unknown): Request {
  return new Request('http://127.0.0.1/api/saves', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('save, list, get, and delete stay on the owner', async () => {
  const { db, env } = mem();
  const a = await signIn(db, 'user-a');
  const b = await signIn(db, 'user-b');
  const created = await handleSaveCollection(post(a, { query: ' trains ', title: 'Trains', card: { line: 1 } }), env);
  assert.equal(created.status, 201);
  const first = (await created.json()) as { id: string; created_at: string };
  assert.equal(typeof first.id, 'string');
  assert.match(first.created_at, /^20/);

  const again = await handleSaveCollection(post(a, { query: 'trains', title: 'Other', card: { line: 2 } }), env);
  assert.equal(again.status, 200);
  const second = (await again.json()) as { id: string };
  assert.equal(second.id, first.id);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_items').get() as { n: number }).n, 1);

  const later = await handleSaveCollection(post(a, { query: 'buses', title: 'Buses', card: { line: 3 } }), env);
  assert.equal(later.status, 201);

  const page = await handleSaveCollection(new Request('http://127.0.0.1/api/saves?limit=1', { headers: { cookie: a } }), env);
  assert.equal(page.status, 200);
  const listed = (await page.json()) as { items: { id: string; query: string; title: string; created_at: string }[]; next: string | null };
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.query, 'buses');
  assert.equal(listed.items[0]?.title, 'Buses');
  assert.equal(typeof listed.next, 'string');

  const rest = await handleSaveCollection(new Request(`http://127.0.0.1/api/saves?limit=50&before=${encodeURIComponent(listed.next || '')}`, { headers: { cookie: a } }), env);
  const older = (await rest.json()) as { items: { query: string }[]; next: string | null };
  assert.deepEqual(older.items.map((item) => item.query), ['trains']);
  assert.equal(older.next, null);

  const mine = await handleSaveItem(new Request(`http://127.0.0.1/api/saves/${first.id}`, { headers: { cookie: a } }), env, first.id);
  assert.equal(mine.status, 200);
  const detail = (await mine.json()) as { card: { line: number }; query: string };
  assert.equal(detail.query, 'trains');
  assert.deepEqual(detail.card, { line: 1 });

  const stolen = await handleSaveItem(new Request(`http://127.0.0.1/api/saves/${first.id}`, { headers: { cookie: b } }), env, first.id);
  assert.equal(stolen.status, 404);
  const removed = await handleSaveItem(new Request(`http://127.0.0.1/api/saves/${first.id}`, { method: 'DELETE', headers: { cookie: b } }), env, first.id);
  assert.equal(removed.status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_items').get() as { n: number }).n, 2);

  const gone = await handleSaveItem(new Request(`http://127.0.0.1/api/saves/${first.id}`, { method: 'DELETE', headers: { cookie: a } }), env, first.id);
  assert.equal(gone.status, 204);
  const missing = await handleSaveItem(new Request(`http://127.0.0.1/api/saves/${first.id}`, { headers: { cookie: a } }), env, first.id);
  assert.equal(missing.status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n, 0);
});

test('signed-out and anonymous saves are 401 and a huge card is 413', async () => {
  const { db, env } = mem();
  const anon = await signIn(db, 'anon', true);
  const signedOut = await handleSaveCollection(post('', { query: 'x', title: 't', card: {} }), env);
  assert.equal(signedOut.status, 401);
  const body = (await signedOut.json()) as { need_signin: boolean; used: number; limit: number; remaining: number; signedIn: boolean };
  assert.equal(body.need_signin, true);
  assert.equal(body.signedIn, false);
  assert.equal(body.used, 0);
  assert.equal(body.limit, 5);
  assert.equal(body.remaining, 5);

  const anonRes = await handleSaveCollection(post(anon, { query: 'x', title: 't', card: {} }), env);
  assert.equal(anonRes.status, 401);

  const user = await signIn(db, 'user-c');
  const big = await handleSaveCollection(post(user, { query: 'big', title: 'Big', card: { blob: 'x'.repeat(70_000) } }), env);
  assert.equal(big.status, 413);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_items').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 2);
});

test('auth off or no database is 404 and writes nothing', async () => {
  const { db, env } = mem();
  const user = await signIn(db, 'user-off');
  const off = { ...env, AUTH_ENABLED: 'false' };
  const res = await handleSaveCollection(post(user, { query: 'x', title: 't', card: { ok: true } }), off);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Sign-in is disabled' });
  const noDb = { AUTH_ENABLED: 'true', SESSION_SECRET: SECRET } as Env;
  const missing = await handleSaveItem(new Request('http://127.0.0.1/api/saves/abc', { headers: { cookie: user } }), noDb, 'abc');
  assert.equal(missing.status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_items').get() as { n: number }).n, 0);
});

test('test token does not create a user or a save', async () => {
  const { db, env } = mem();
  env.ZO_TEST_TOKEN = 'probe-token';
  const res = await handleSaveCollection(
    new Request('http://127.0.0.1/api/saves', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zo-test-token': 'probe-token' },
      body: JSON.stringify({ query: 'x', title: 't', card: { ok: true } }),
    }),
    env,
  );
  assert.equal(res.status, 401);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saved_items').get() as { n: number }).n, 0);
});
