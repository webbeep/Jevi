import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { carrySubject } from '../server/auth/carry.ts';
import { signDevice } from '../server/auth/device.ts';
import { applyGate, bumpUsage } from '../server/auth/gate.ts';
import { safeReturnPath } from '../server/auth/facade.ts';
import { recordEvent } from '../server/auth/events.ts';
import type { ZoUser } from '../server/auth/session.ts';
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
            async run() {
              db.prepare(sql).run(...(args as []));
              return { success: true };
            },
            async first() {
              return db.prepare(sql).get(...(args as [])) ?? null;
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
  if (decisions[4]?.ok) assert.equal(decisions[4].headers?.['X-ZO-Used'], '5');
  assert.equal(decisions[5]?.ok, false);
  if (!decisions[5]?.ok) {
    assert.deepEqual(decisions[5].body, { need_signin: true, used: 6, limit: 5, reason: 'device' });
  }
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
  if (!c.ok) assert.equal(c.body.reason, 'signed');
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
  if (!second.ok) assert.equal(second.body.reason, 'ip');
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
