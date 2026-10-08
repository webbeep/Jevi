import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { EVENT_MAX_BYTES, EVENT_NAMES, recordEvent } from '../server/auth/events.ts';
import type { Env } from '../server/util.ts';

function mem() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      props_json TEXT,
      created_at TEXT NOT NULL,
      subject_key TEXT
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
  return { db, env: { DB: d1 } as unknown as Env };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

test('new allowlist names are stored and unknown names are dropped', async () => {
  const { db, env } = mem();
  for (const name of ['try_free_clicked', 'save_click', 'signin_error', 'sync_toggle'] as const) {
    const res = await recordEvent(post(JSON.stringify({ name, props: { surface: 'menu' } })), env);
    assert.equal(res.status, 204);
  }
  assert.equal(EVENT_NAMES.includes('value_prompt_shown'), true);
  assert.equal(EVENT_NAMES.includes('affiliate_clicked'), true);
  const unknown = await recordEvent(post(JSON.stringify({ name: 'email_optin', props: { on: true } })), env);
  assert.equal(unknown.status, 204);
  const names = db.prepare('SELECT name FROM events ORDER BY name').all() as { name: string }[];
  assert.deepEqual(names.map((row) => row.name), ['save_click', 'signin_error', 'sync_toggle', 'try_free_clicked']);
});

test('a body over 1024 bytes is dropped and pii stays out', async () => {
  const { db, env } = mem();
  const big = JSON.stringify({ name: 'search_submitted', props: { q: 'x'.repeat(EVENT_MAX_BYTES) } });
  assert.equal(new TextEncoder().encode(big).length > EVENT_MAX_BYTES, true);
  const dropped = await recordEvent(post(big), env);
  assert.equal(dropped.status, 204);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, 0);

  const fit = JSON.stringify({ name: 'source_opened', props: { email: 'a@b.c', host: 'example.com' } });
  assert.equal(new TextEncoder().encode(fit).length <= EVENT_MAX_BYTES, true);
  const kept = await recordEvent(post(fit), env);
  assert.equal(kept.status, 204);
  const row = db.prepare('SELECT props_json FROM events').get() as { props_json: string };
  assert.equal(row.props_json.includes('a@b.c'), false);
  assert.equal(row.props_json.includes('example.com'), true);

  const bad = await recordEvent(post('{'), env);
  assert.equal(bad.status, 400);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, 1);
});
