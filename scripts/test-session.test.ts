import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { signDevice } from '../server/auth/device.ts';
import { handleSaveCollection } from '../server/auth/saves.ts';
import { currentUser } from '../server/auth/session.ts';
import { handleTestSession } from '../server/auth/testSession.ts';
import type { Env } from '../server/util.ts';

const SECRET = 'test-session-secret-32chars!!';

function mem(track = true) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      isAnonymous INTEGER,
      src_utm TEXT
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY NOT NULL,
      expiresAt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL
    );
    CREATE TABLE usage (
      day TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, subject_key)
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
  let prepares = 0;
  const d1 = {
    prepare(sql: string) {
      prepares += 1;
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
  const env = {
    DB: track ? d1 : undefined,
    SESSION_SECRET: SECRET,
    AUTH_ENABLED: 'true',
    ZO_TEST_SESSION: 'on',
    GATE_ANON_PER_DAY: '5',
  } as unknown as Env;
  return { db, env, prepares: () => prepares };
}

function post(url: string, envReady: { cookie?: string; body?: unknown } = {}): Request {
  const headers = new Headers();
  if (envReady.cookie) headers.set('cookie', envReady.cookie);
  if (envReady.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(url, {
    method: 'POST',
    headers,
    body: envReady.body === undefined ? undefined : JSON.stringify(envReady.body),
  });
}

function cookiePair(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0] || '';
}

test('non-local host is 404 even when the test session env is on', async () => {
  const { db, env, prepares } = mem();
  const res = await handleTestSession(
    post('https://zo2.example/api/auth/test-session', { body: { email: 'a@zo.local' } }),
    env,
  );
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
  assert.equal(prepares(), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, 0);
});

test('localhost without ZO_TEST_SESSION is 404 and the test header creates nothing', async () => {
  const { db, env, prepares } = mem();
  delete env.ZO_TEST_SESSION;
  const res = await handleTestSession(
    new Request('http://localhost/api/auth/test-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zo-test-token': 'probe-token' },
      body: JSON.stringify({ email: 'a@zo.local' }),
    }),
    env,
  );
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
  assert.equal(prepares(), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, 0);
});

test('AUTH_ENABLED off is 404 with no D1 access', async () => {
  const { db, env, prepares } = mem();
  env.AUTH_ENABLED = 'false';
  const res = await handleTestSession(post('http://127.0.0.1/api/auth/test-session', { body: {} }), env);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
  assert.equal(prepares(), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 0);
});

test('missing database is 404', async () => {
  const { env } = mem(false);
  const res = await handleTestSession(post('http://[::1]/api/auth/test-session'), env);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('success creates a user and session and the cookie verifies', async () => {
  const { db, env } = mem();
  const res = await handleTestSession(post('http://127.0.0.1/api/auth/test-session', { body: { email: 'qa@zo.local', name: 'QA Lane' } }), env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { id: string; email: string; name: string; avatar: null } };
  assert.equal(body.user.email, 'qa@zo.local');
  assert.equal(body.user.name, 'QA Lane');
  assert.equal(body.user.avatar, null);
  assert.equal(typeof body.user.id, 'string');

  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /^zo_sess=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=604800/);
  assert.equal(setCookie.includes('Secure'), false);

  const user = await currentUser(new Request('http://127.0.0.1/api/auth/me', { headers: { cookie: cookiePair(res) } }), env);
  assert.ok(user);
  assert.equal(user.anonymous, false);
  assert.equal(user.id, body.user.id);
  assert.equal(user.email, 'qa@zo.local');
  assert.equal(user.name, 'QA Lane');

  const row = db.prepare('SELECT isAnonymous, email FROM user').get() as { isAnonymous: number; email: string };
  assert.equal(row.isAnonymous, 0);
  assert.equal(row.email, 'qa@zo.local');
  const session = db.prepare('SELECT ipAddress, expiresAt, userId FROM session').get() as { ipAddress: string; expiresAt: string; userId: string };
  assert.equal(session.ipAddress, '');
  assert.equal(session.userId, body.user.id);
  const life = new Date(session.expiresAt).getTime() - Date.now();
  assert.ok(life > 6.9 * 24 * 60 * 60 * 1000 && life < 7.1 * 24 * 60 * 60 * 1000);

  const again = await handleTestSession(post('http://localhost/api/auth/test-session', { body: { email: 'qa@zo.local', name: 'Other' } }), env);
  assert.equal(again.status, 200);
  const reused = (await again.json()) as { user: { id: string; name: string } };
  assert.equal(reused.user.id, body.user.id);
  assert.equal(reused.user.name, 'QA Lane');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, 2);

  const fresh = await handleTestSession(post('http://127.0.0.1/api/auth/test-session'), env);
  const created = (await fresh.json()) as { user: { email: string; name: string } };
  assert.match(created.user.email, /^qa\+[0-9a-f]{8}@zo\.local$/);
  assert.equal(created.user.name, 'QA Test');
});

test('saves POST accepts the test-session cookie', async () => {
  const { env } = mem();
  const res = await handleTestSession(post('http://127.0.0.1/api/auth/test-session', { body: { email: 'save@zo.local', name: 'Saver' } }), env);
  const saved = await handleSaveCollection(
    new Request('http://127.0.0.1/api/saves', {
      method: 'POST',
      headers: { cookie: cookiePair(res), 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'trains', title: 'Trains', card: { line: 1 } }),
    }),
    env,
  );
  assert.equal(saved.status, 201);
  const item = (await saved.json()) as { id: string };
  assert.equal(typeof item.id, 'string');
});

test('carry moves device usage onto the user and keeps the device row', async () => {
  const { db, env } = mem();
  const deviceId = 'ab'.repeat(16);
  const signed = await signDevice(deviceId, SECRET);
  db.prepare(`INSERT INTO usage (day, subject_key, count) VALUES ('2026-10-08', ?, 3)`).run(`d:${deviceId}`);
  const res = await handleTestSession(
    post('http://127.0.0.1/api/auth/test-session', { cookie: `zo_dev=${encodeURIComponent(signed)}`, body: { email: 'carry@zo.local', name: 'Carry', carry: true } }),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { id: string } };
  const rows = db.prepare('SELECT subject_key, count FROM usage ORDER BY subject_key').all() as { subject_key: string; count: number }[];
  assert.deepEqual(
    rows.map((row) => ({ subject_key: row.subject_key, count: row.count })),
    [
      { subject_key: `d:${deviceId}`, count: 3 },
      { subject_key: `u:${body.user.id}`, count: 3 },
    ],
  );
});

test('https sets a Secure session cookie and DELETE drops that session', async () => {
  const { db, env } = mem();
  const res = await handleTestSession(post('https://localhost/api/auth/test-session', { body: { email: 'sec@zo.local' } }), env);
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /^__Secure-zo_sess=/);
  assert.match(setCookie, /Secure/);
  const pair = cookiePair(res);
  const user = await currentUser(new Request('https://localhost/api/auth/me', { headers: { cookie: pair } }), env);
  assert.ok(user);

  const gone = await handleTestSession(new Request('https://localhost/api/auth/test-session', { method: 'DELETE', headers: { cookie: pair } }), env);
  assert.equal(gone.status, 204);
  assert.match(gone.headers.get('set-cookie') || '', /__Secure-zo_sess=;/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, 0);
  const after = await currentUser(new Request('https://localhost/api/auth/me', { headers: { cookie: pair } }), env);
  assert.equal(after, null);
});
