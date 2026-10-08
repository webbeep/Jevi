import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handlePrefs } from '../server/auth/prefs.ts';
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
    CREATE TABLE user_prefs (
      user_id TEXT PRIMARY KEY,
      sync_history INTEGER NOT NULL DEFAULT 0,
      history_json TEXT,
      updated_at INTEGER NOT NULL
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

function put(cookie: string, body: unknown): Request {
  return new Request('http://127.0.0.1/api/account/prefs', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('prefs default off, store history only while sync is on, and skip the ask counter', async () => {
  const { db, env } = mem();
  const a = await signIn(db, 'user-a');
  const b = await signIn(db, 'user-b');
  const fresh = await handlePrefs(new Request('http://127.0.0.1/api/account/prefs', { headers: { cookie: a } }), env);
  assert.equal(fresh.status, 200);
  assert.deepEqual(await fresh.json(), { sync_history: false, history: [] });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_prefs').get() as { n: number }).n, 0);

  const ignored = await handlePrefs(put(a, { history: [' trains ', 'trains', 'buses'] }), env);
  assert.equal(ignored.status, 200);
  assert.deepEqual(await ignored.json(), { sync_history: false, history: [] });
  assert.equal((db.prepare(`SELECT history_json FROM user_prefs WHERE user_id = 'user-a'`).get() as { history_json: string | null }).history_json, null);

  const long = `  ${'n'.repeat(250)}  `;
  const saved = await handlePrefs(
    put(a, { sync_history: true, history: [' trains ', 'trains', '', '  ', long, 12, ...Array.from({ length: 60 }, (_, i) => `q${i}`)] }),
    env,
  );
  assert.equal(saved.status, 200);
  const body = (await saved.json()) as { sync_history: boolean; history: string[] };
  assert.equal(body.sync_history, true);
  assert.equal(body.history[0], 'trains');
  assert.equal(body.history[1], 'n'.repeat(200));
  assert.equal(body.history.length, 50);
  assert.equal(body.history.includes('q47'), true);
  assert.equal(body.history.includes('q48'), false);

  const other = await handlePrefs(new Request('http://127.0.0.1/api/account/prefs', { headers: { cookie: b } }), env);
  assert.deepEqual(await other.json(), { sync_history: false, history: [] });

  const kept = await handlePrefs(put(a, { sync_history: true }), env);
  const keptBody = (await kept.json()) as { history: string[] };
  assert.equal(keptBody.history.length, 50);

  const off = await handlePrefs(put(a, { sync_history: false, history: ['should-not-stick'] }), env);
  assert.deepEqual(await off.json(), { sync_history: false, history: [] });
  const row = db.prepare(`SELECT sync_history, history_json FROM user_prefs WHERE user_id = 'user-a'`).get() as {
    sync_history: number;
    history_json: string | null;
  };
  assert.equal(row.sync_history, 0);
  assert.equal(row.history_json, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n, 0);
});

test('signed-out prefs are 401, auth off is 404, and a huge body is 413', async () => {
  const { db, env } = mem();
  const anon = await signIn(db, 'anon', true);
  const signedOut = await handlePrefs(new Request('http://127.0.0.1/api/account/prefs'), env);
  assert.equal(signedOut.status, 401);
  const body = (await signedOut.json()) as { need_signin: boolean; used: number; limit: number; remaining: number; signedIn: boolean };
  assert.equal(body.need_signin, true);
  assert.equal(body.signedIn, false);
  assert.equal(body.used, 0);
  assert.equal(body.limit, 5);
  assert.equal(body.remaining, 5);

  const anonRes = await handlePrefs(put(anon, { sync_history: true, history: ['x'] }), env);
  assert.equal(anonRes.status, 401);

  const off = await handlePrefs(put('', { sync_history: true }), { ...env, AUTH_ENABLED: 'false' });
  assert.equal(off.status, 404);
  assert.deepEqual(await off.json(), { error: 'Sign-in is disabled' });
  const noDb = await handlePrefs(new Request('http://127.0.0.1/api/account/prefs'), { AUTH_ENABLED: 'true', SESSION_SECRET: SECRET });
  assert.equal(noDb.status, 404);

  const user = await signIn(db, 'user-c');
  const huge = JSON.stringify({ sync_history: true, history: ['x'.repeat(20_000)] });
  const res = await handlePrefs(
    new Request('http://127.0.0.1/api/account/prefs', {
      method: 'PUT',
      headers: { cookie: user, 'content-type': 'application/json' },
      body: huge,
    }),
    env,
  );
  assert.equal(res.status, 413);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM user_prefs WHERE user_id = 'user-c'`).get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n, 0);
});
