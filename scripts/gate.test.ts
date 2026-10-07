import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carrySubject } from '../server/auth/carry.ts';
import { signDevice } from '../server/auth/device.ts';
import { applyGate, bumpUsage } from '../server/auth/gate.ts';
import { me, safeReturnPath } from '../server/auth/facade.ts';
import { recordEvent } from '../server/auth/events.ts';
import { signSessionToken, type ZoUser } from '../server/auth/session.ts';
import type { Env } from '../server/util.ts';

const SECRET = 'test-session-secret-32chars!!';
const IP = '203.0.113.44';

function mem() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE usage (day TEXT NOT NULL, subject_key TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, subject_key));
    CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, props_json TEXT, created_at TEXT NOT NULL, subject_key TEXT);
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
  return { db, env: { DB: d1, SESSION_SECRET: SECRET, IP_HASH_SALT: 'salt-not-the-ip' } as unknown as Env };
}

function keys(db: DatabaseSync): string[] {
  return db.prepare('SELECT subject_key FROM usage ORDER BY subject_key').all().map((r) => String((r as { subject_key: string }).subject_key));
}

async function cookie(): Promise<string> {
  return `zo_dev=${encodeURIComponent(await signDevice('a'.repeat(32), SECRET))}`;
}

const nobody = async () => null;
const signed = async (): Promise<ZoUser> => ({ id: 'user-1', email: 'a@b.c', name: 'A', avatar: null, anonymous: false });

test('counts anonymous asks and blocks on the device limit', async () => {
  const { env } = mem();
  env.AUTH_ENABLED = 'true';
  env.GATE_ANON_PER_DAY = '5';
  const headers = { cookie: await cookie() };
  const decisions = [];
  for (let i = 0; i < 6; i++) decisions.push(await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T12:00:00Z'), nobody));
  assert.equal(decisions[4]?.ok, true);
  if (decisions[4]?.ok) {
    assert.equal(decisions[4].headers?.['X-ZO-Used'], '5');
    assert.equal(decisions[4].headers?.['X-ZO-Limit'], '5');
    assert.equal(decisions[4].headers?.['X-ZO-Remaining'], '0');
  }
  assert.equal(decisions[5]?.ok, false);
  if (!decisions[5]?.ok) {
    assert.deepEqual(decisions[5].body, { need_signin: true, used: 6, limit: 5, remaining: 0, signedIn: false, reason: 'device' });
  }
});

function usageRows(db: DatabaseSync): { subject_key: string; count: number }[] {
  return db.prepare('SELECT subject_key, count FROM usage ORDER BY subject_key').all() as { subject_key: string; count: number }[];
}

test('x-zo-retry does not increment device, IP, or signed counts', async () => {
  const { db, env } = mem();
  env.AUTH_ENABLED = 'true';
  env.GATE_ANON_PER_DAY = '5';
  env.GATE_IP_PER_DAY = '30';
  const when = new Date('2026-10-07T12:00:00Z');
  const headers = { cookie: await cookie(), 'CF-Connecting-IP': IP };
  const first = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when, nobody);
  assert.equal(first.ok, true);
  const afterOne = usageRows(db);
  const under = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { ...headers, 'x-zo-retry': '1' } }), env, when, nobody);
  assert.equal(under.ok, true);
  if (under.ok) {
    assert.equal(under.headers?.['X-ZO-Used'], '1');
    assert.equal(under.headers?.['X-ZO-Remaining'], '4');
  }
  assert.deepEqual(usageRows(db), afterOne);

  for (let i = 0; i < 4; i++) await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when, nobody);
  const atCap = usageRows(db);
  assert.equal(atCap.find((r) => r.subject_key.startsWith('d:'))?.count, 5);
  assert.equal(atCap.find((r) => r.subject_key.startsWith('ip:'))?.count, 5);
  const atLimit = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { ...headers, 'X-ZO-Retry': '1' } }), env, when, nobody);
  assert.equal(atLimit.ok, true);
  if (atLimit.ok) {
    assert.equal(atLimit.headers?.['X-ZO-Used'], '5');
    assert.equal(atLimit.headers?.['X-ZO-Remaining'], '0');
  }
  assert.deepEqual(usageRows(db), atCap);

  const manual = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { ...headers, 'x-zo-retry': '0' } }), env, when, nobody);
  assert.equal(manual.ok, false);
  if (!manual.ok) assert.deepEqual(manual.body, { need_signin: true, used: 6, limit: 5, remaining: 0, signedIn: false, reason: 'device' });
  const over = usageRows(db);
  assert.equal(over.find((r) => r.subject_key.startsWith('d:'))?.count, 6);
  assert.equal(over.find((r) => r.subject_key.startsWith('ip:'))?.count, 6);
  const stillOver = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { ...headers, 'x-zo-retry': '1' } }), env, when, nobody);
  assert.equal(stillOver.ok, false);
  if (!stillOver.ok) assert.equal(stillOver.body.used, 6);
  assert.deepEqual(usageRows(db), over);

  env.GATE_SIGNED_PER_DAY = '1';
  const signedHeaders = { ...headers };
  const allowed = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: signedHeaders }), env, when, signed);
  assert.equal(allowed.ok, true);
  const signedRows = usageRows(db);
  assert.equal(signedRows.find((r) => r.subject_key === 'u:user-1')?.count, 1);
  assert.equal(signedRows.some((r) => r.subject_key.startsWith('d:')), true);
  const signedRetry = await applyGate(
    new Request('http://127.0.0.1/api/stream', { headers: { ...signedHeaders, 'x-zo-retry': '1' } }),
    env,
    when,
    signed,
  );
  assert.equal(signedRetry.ok, true);
  if (signedRetry.ok) assert.equal(signedRetry.headers?.['X-ZO-Used'], '1');
  assert.deepEqual(usageRows(db), signedRows);
});

test('a new device cookie starts its own count', async () => {
  const { db, env } = mem();
  env.AUTH_ENABLED = 'true';
  const first = { cookie: await cookie() };
  for (let i = 0; i < 5; i++) await applyGate(new Request('http://127.0.0.1/api/stream', { headers: first }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  const other = `zo_dev=${encodeURIComponent(await signDevice('b'.repeat(32), SECRET))}`;
  const next = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { cookie: other } }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  assert.equal(next.ok, true);
  if (next.ok) assert.equal(next.headers?.['X-ZO-Used'], '1');
  assert.equal(keys(db).length, 2);
});

test('AUTH_ENABLED off counts and never blocks', async () => {
  const { env } = mem();
  env.GATE_ANON_PER_DAY = '1';
  const headers = { cookie: await cookie() };
  const first = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  const second = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.headers?.['X-ZO-Used'], '2');
});

test('signed-in users use the signed-in cap', async () => {
  const { env } = mem();
  env.AUTH_ENABLED = 'true';
  env.GATE_SIGNED_PER_DAY = '2';
  const headers = { cookie: await cookie() };
  const a = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), signed);
  const b = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), signed);
  const c = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), signed);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, false);
  if (!c.ok) {
    assert.equal(c.body.reason, 'signed');
    assert.equal(c.body.signedIn, true);
    assert.equal(c.body.remaining, 0);
  }
});

test('test token bypasses the daily gate', async () => {
  const { db, env } = mem();
  env.AUTH_ENABLED = 'true';
  env.GATE_ANON_PER_DAY = '1';
  env.ZO_TEST_TOKEN = 'probe-token';
  const headers = { cookie: await cookie(), 'x-zo-test-token': 'probe-token' };
  const decision = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  assert.equal(decision.ok, true);
  assert.equal(keys(db).length, 0);
  const wrong = await applyGate(
    new Request('http://127.0.0.1/api/stream', { headers: { cookie: headers.cookie, 'x-zo-test-token': 'nope' } }),
    env,
    new Date('2026-10-07T00:00:00Z'),
    nobody,
  );
  assert.equal(wrong.ok, true);
  const blocked = await applyGate(new Request('http://127.0.0.1/api/stream', { headers: { cookie: headers.cookie } }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  assert.equal(blocked.ok, false);
});

test('missing DB is a no-op', async () => {
  const decision = await applyGate(new Request('http://127.0.0.1/api/stream'), { AUTH_ENABLED: 'true', SESSION_SECRET: SECRET }, new Date(), nobody);
  assert.deepEqual(decision, { ok: true });
});

test('IP hash is stored and the raw IP is not', async () => {
  const { db, env } = mem();
  env.AUTH_ENABLED = 'true';
  env.GATE_IP_PER_DAY = '1';
  const headers = { cookie: await cookie(), 'CF-Connecting-IP': IP };
  await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  const second = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'), nobody);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.body.reason, 'ip');
    assert.equal(second.body.signedIn, false);
    assert.equal(second.body.remaining, 0);
  }
  const stored = keys(db);
  assert.equal(stored.some((k) => k.startsWith('ip:') && /^ip:[0-9a-f]{64}$/.test(k)), true);
  assert.equal(stored.some((k) => k.includes(IP)), false);
  const blob = JSON.stringify(db.prepare('SELECT * FROM usage').all());
  assert.equal(blob.includes(IP), false);
});

test('onLinkAccount carry moves anon usage onto the new user and keeps the device row', async () => {
  const { db, env } = mem();
  const d1 = (env as unknown as { DB: D1Database }).DB;
  await bumpUsage(d1, '2026-10-07', 'u:anon');
  await bumpUsage(d1, '2026-10-07', 'u:anon');
  await bumpUsage(d1, '2026-10-07', 'u:real');
  await bumpUsage(d1, '2026-10-07', 'd:device1');
  await carrySubject(d1, 'anon', 'real', 'device1');
  const rows = db.prepare('SELECT subject_key, count FROM usage ORDER BY subject_key').all() as { subject_key: string; count: number }[];
  assert.deepEqual(
    rows.map((r) => ({ subject_key: r.subject_key, count: r.count })),
    [
      { subject_key: 'd:device1', count: 1 },
      { subject_key: 'u:real', count: 4 },
    ],
  );
});

test('return path stays on this origin', () => {
  assert.equal(safeReturnPath('/welcome'), '/welcome');
  assert.equal(safeReturnPath('https://evil.example/phish'), '/');
  assert.equal(safeReturnPath('//evil.example'), '/');
});

test('events allowlist drops pii and stores the rest', async () => {
  const { db, env } = mem();
  const res = await recordEvent(
    new Request('http://127.0.0.1/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await cookie() },
      body: JSON.stringify({ name: 'gate_hit', props: { email: 'a@b.c', place: 'sheet', note: 'person@example.com' } }),
    }),
    env,
  );
  assert.equal(res.status, 204);
  const row = db.prepare('SELECT name, props_json, subject_key FROM events').get() as { name: string; props_json: string; subject_key: string };
  assert.equal(row.name, 'gate_hit');
  assert.equal(row.props_json.includes('a@b.c'), false);
  assert.equal(row.props_json.includes('person@example.com'), false);
  assert.equal(row.props_json.includes('sheet'), true);
  assert.match(row.subject_key, /^d:/);
  const bad = await recordEvent(new Request('http://127.0.0.1/api/events', { method: 'POST', body: JSON.stringify({ name: 'nope' }) }), env);
  assert.equal(bad.status, 400);
});

test('a signed zo_sess cookie is one session lookup and uses the signed-in cap', async () => {
  const { db, env } = mem();
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, isAnonymous INTEGER, createdAt TEXT, updatedAt TEXT, emailVerified INTEGER);
    CREATE TABLE session (id TEXT PRIMARY KEY, token TEXT, userId TEXT, expiresAt TEXT, createdAt TEXT, updatedAt TEXT);
  `);
  env.AUTH_ENABLED = 'true';
  env.GATE_SIGNED_PER_DAY = '1';
  const token = 'sess-token-no-dots';
  db.prepare(`INSERT INTO user (id, name, email, isAnonymous, createdAt, updatedAt) VALUES ('user-9', 'Nine', 'n@e.x', 0, '2026-10-01', '2026-10-01')`).run();
  db.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES ('s1', ?, 'user-9', '2026-12-01T00:00:00.000Z', '2026-10-01', '2026-10-01')`).run(token);
  const cookieHeader = `${await cookie()}; zo_sess=${await signSessionToken(token, SECRET)}`;
  const headers = { cookie: cookieHeader };
  const when = new Date();
  const first = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when);
  const second = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.headers?.['X-ZO-Remaining'], '0');
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.body.reason, 'signed');
  assert.equal(keys(db).some((k) => k === 'u:user-9'), true);
  assert.equal(keys(db).some((k) => k.startsWith('d:')), false);
  const body = (await (await me(new Request('http://127.0.0.1/api/auth/me', { headers }), env)).json()) as {
    used: number;
    limit: number;
    remaining: number;
    signedIn: boolean;
    day: string;
    user: { id: string } | null;
    auth_enabled: boolean;
  };
  assert.equal(body.auth_enabled, true);
  assert.equal(body.signedIn, true);
  assert.equal(body.user?.id, 'user-9');
  assert.equal(body.used, 2);
  assert.equal(body.limit, 1);
  assert.equal(body.remaining, 0);
  assert.equal(body.day, when.toISOString().slice(0, 10));
});

test('an anonymous session still counts as logged out', async () => {
  const { db, env } = mem();
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, isAnonymous INTEGER, createdAt TEXT, updatedAt TEXT, emailVerified INTEGER);
    CREATE TABLE session (id TEXT PRIMARY KEY, token TEXT, userId TEXT, expiresAt TEXT, createdAt TEXT, updatedAt TEXT);
  `);
  env.AUTH_ENABLED = 'true';
  env.GATE_ANON_PER_DAY = '1';
  const token = 'anon-token';
  db.prepare(`INSERT INTO user (id, name, email, isAnonymous, createdAt, updatedAt) VALUES ('anon-1', 'Anon', 'a@anon', 1, '2026-10-01', '2026-10-01')`).run();
  db.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES ('s2', ?, 'anon-1', '2026-12-01T00:00:00.000Z', '2026-10-01', '2026-10-01')`).run(token);
  const headers = { cookie: `${await cookie()}; zo_sess=${await signSessionToken(token, SECRET)}` };
  const when = new Date('2026-10-07T00:00:00Z');
  const first = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when);
  const second = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, when);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.body.reason, 'device');
  assert.equal(keys(db).some((k) => k.startsWith('u:')), false);
});

test('test token never counts and never writes a session', async () => {
  const { db, env } = mem();
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, token TEXT);
  `);
  env.AUTH_ENABLED = 'true';
  env.GATE_ANON_PER_DAY = '1';
  env.ZO_TEST_TOKEN = 'probe-token';
  const headers = { cookie: await cookie(), 'X-Zo-Test-Token': 'probe-token' };
  const decision = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), env, new Date('2026-10-07T00:00:00Z'));
  assert.equal(decision.ok, true);
  assert.equal(keys(db).length, 0);
  const users = db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number };
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number };
  assert.equal(users.n, 0);
  assert.equal(sessions.n, 0);
  const unset = { ...env, ZO_TEST_TOKEN: undefined };
  const counted = await applyGate(new Request('http://127.0.0.1/api/stream', { headers }), unset, new Date('2026-10-07T00:00:00Z'), async () => null);
  assert.equal(counted.ok, true);
  assert.equal(keys(db).length, 1);
});

test('stream and middleware module graphs do not import better-auth', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const starts = [resolve(root, 'functions/api/stream.ts'), resolve(root, 'functions/api/_middleware.ts')];
  const seen = new Set<string>();
  const fromRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  const dynRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    const specs = [...text.matchAll(fromRe), ...text.matchAll(dynRe)].map((m) => m[1] ?? '');
    for (const spec of specs) {
      assert.equal(spec.includes('better-auth'), false, `${file} reaches ${spec}`);
      if (!spec.startsWith('.')) continue;
      let next = resolve(dirname(file), spec);
      if (!next.endsWith('.ts')) next += '.ts';
      visit(next);
    }
  };
  for (const start of starts) visit(start);
  assert.equal(seen.size > 2, true);
});
