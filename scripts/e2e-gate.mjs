#!/usr/bin/env node
/**
 * G9 API gate. No LLM spend: POST /api/stream bodies are `{}`.
 * The gate runs before body validation, so 200 or 400 (or an SSE error) is an allowed ask.
 *
 *   node scripts/e2e-gate.mjs <base> --auth=on|off [--d1-local=<dbname> --persist=<dir>]
 *
 * Local test token: env ZO_TEST_TOKEN_VALUE (the dummy from .dev.vars). Never printed.
 * Remote test token: read at runtime from the path in ZO_TEST_TOKEN_FILE. Never printed.
 * Signed-in daily cap compared to env GATE_SIGNED_PER_DAY (default 100). One ask only.
 * --auth=on is local only. --auth=off against a remote host sends 3 stream asks at most.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const baseArg = args.find((a) => /^https?:\/\//.test(a));
const BASE = (baseArg || '').replace(/\/$/, '');
const authFlag = (args.find((a) => a.startsWith('--auth=')) || '').slice(7);
const d1Name = (args.find((a) => a.startsWith('--d1-local=')) || '').slice('--d1-local='.length);
const persist = (args.find((a) => a.startsWith('--persist=')) || '').slice('--persist='.length);
const SIGNED_LIMIT = Number(process.env.GATE_SIGNED_PER_DAY || 100);
const ROOT = new URL('..', import.meta.url).pathname;
const NODE_PATH = `${process.env.HOME}/.local/node22/bin:${process.env.HOME}/.local/bin:${process.env.PATH || ''}`;

let failures = 0;
let token = '';

function redact(text) {
  let out = String(text ?? '');
  if (token) out = out.split(token).join('[redacted]');
  return out.replace(/zo_sess=[^;\s]+/gi, 'zo_sess=[redacted]').replace(/zo_dev=[^;\s]+/gi, 'zo_dev=[redacted]');
}

function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${redact(label)}`);
  if (!ok) failures++;
}

function isLocalHost(base) {
  const host = new URL(base).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]' || host.endsWith('.local');
}

function loadToken(local) {
  if (local) return (process.env.ZO_TEST_TOKEN_VALUE || '').trim();
  const file = process.env.ZO_TEST_TOKEN_FILE;
  if (!file) return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

class Jar {
  constructor(ip) {
    this.ip = ip;
    this.cookies = new Map();
  }
  take(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(sc) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(name) {
    return [...this.cookies.keys()].some((k) => k === name || k.endsWith(name));
  }
}

function numHeader(res, name) {
  const raw = res.headers.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function req(jar, path, { method = 'GET', body, headers = {}, redirect = 'manual' } = {}) {
  const h = { ...headers };
  // Cloudflare rejects a client-sent CF-Connecting-IP (403), so only fake IPs against local wrangler.
  if (jar?.ip && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(BASE).hostname)) h['CF-Connecting-IP'] = jar.ip;
  if (jar && jar.cookies.size) h.cookie = jar.header();
  if (body !== undefined) h['content-type'] = 'application/json';
  let res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  // A shared-box 429 is a rerun, not a result. Wait once and repeat the same call.
  if (res.status === 429 && !h['x-zo-test-token']) {
    const wait = Math.min(65, Math.max(1, Number(res.headers.get('retry-after')) || 2));
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect });
  }
  jar?.take(res);
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('text/event-stream')) await res.body?.cancel();
  else {
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
  }
  return { status: res.status, headers: res.headers, data };
}

function allowedAsk(status) {
  return status === 200 || status === 400;
}

function usageOf(r) {
  return {
    used: numHeader(r, 'x-zo-used'),
    limit: numHeader(r, 'x-zo-limit'),
    remaining: numHeader(r, 'x-zo-remaining'),
  };
}

async function d1Rows(sql) {
  const out = await new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['wrangler', 'd1', 'execute', d1Name, '--local', '--persist-to', persist, '--command', sql, '--json'],
      { cwd: ROOT, env: { ...process.env, PATH: NODE_PATH } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  if (out.code !== 0) throw new Error(`d1 exit ${out.code}: ${redact(out.stderr).slice(0, 180)}`);
  const start = out.stdout.indexOf('[');
  const end = out.stdout.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('d1 json missing');
  const parsed = JSON.parse(out.stdout.slice(start, end + 1));
  return parsed?.[0]?.results ?? [];
}

async function d1(sql) {
  const row = (await d1Rows(sql))[0] ?? {};
  const n = row.n ?? row['count(*)'] ?? Object.values(row)[0];
  return Number(n);
}

async function countTable(table) {
  return d1(`SELECT COUNT(*) AS n FROM ${table}`);
}

async function authOff(remote) {
  const jar = new Jar('203.0.113.10');
  const me = await req(jar, '/api/auth/me');
  check(me.status === 200 && me.data?.auth_enabled === false, '/api/auth/me auth_enabled false');
  const start = await req(jar, '/api/auth/start?return=%2F');
  check(start.status === 404, '/api/auth/start → 404');
  const saves = await req(jar, '/api/saves');
  check(saves.status === 404, '/api/saves → 404');
  const prefs = await req(jar, '/api/account/prefs');
  check(prefs.status === 404, '/api/account/prefs → 404');
  const out = await req(jar, '/api/auth/logout', { method: 'POST' });
  check(out.status === 204, 'logout 204');

  const asks = remote ? 2 : 8;
  let sawHeaders = false;
  for (let i = 1; i <= asks; i++) {
    const r = await req(jar, '/api/stream', { method: 'POST', body: {} });
    const u = usageOf(r);
    const headersOk = u.used != null && u.limit != null && u.remaining != null;
    if (headersOk) sawHeaders = true;
    const counted = !headersOk || u.used === i;
    check(r.status !== 401 && allowedAsk(r.status) && counted, `ask ${i} never 401${headersOk ? ` used=${u.used} limit=${u.limit} remaining=${u.remaining}` : ''}`);
  }
  if (d1Name || sawHeaders) {
    check(sawHeaders, 'X-ZO-Used/Limit/Remaining present');
  } else {
    check(true, 'X-ZO-Used/Limit/Remaining absent (DB not bound)');
  }

  if (remote) {
    const before = await req(jar, '/api/auth/me');
    const beforeUsed = before.data?.used;
    if (!token) {
      check(false, 'remote token ask skipped (ZO_TEST_TOKEN_FILE unset or unreadable)');
      return;
    }
    const bypass = await req(jar, '/api/stream', { method: 'POST', body: {}, headers: { 'x-zo-test-token': token } });
    const after = await req(jar, '/api/auth/me');
    const noUsed = numHeader(bypass, 'x-zo-used') == null;
    const unchanged = beforeUsed === after.data?.used;
    check(allowedAsk(bypass.status) && bypass.status !== 401 && (noUsed || unchanged), 'token ask bypasses gate (no X-ZO-Used or unchanged count)');
  }
}

async function authOn() {
  const limitJar = new Jar('203.0.113.20');
  const me = await req(limitJar, '/api/auth/me');
  const limit = Number(me.data?.limit);
  check(me.status === 200 && me.data?.auth_enabled === true && me.data?.signedIn === false && me.data?.user == null && Number.isFinite(limit) && limit > 0, `/api/auth/me auth on signed out limit=${Number.isFinite(limit) ? limit : 'bad'}`);
  if (!Number.isFinite(limit) || limit <= 0) return;

  for (let i = 1; i <= limit; i++) {
    const r = await req(limitJar, '/api/stream', { method: 'POST', body: {} });
    const u = usageOf(r);
    check(
      allowedAsk(r.status) && u.used === i && u.limit === limit && u.remaining === limit - i,
      `ask ${i}/${limit} allowed used=${u.used} limit=${u.limit} remaining=${u.remaining} status=${r.status}`,
    );
  }

  const beforeRetry = await req(limitJar, '/api/auth/me');
  const retry = await req(limitJar, '/api/stream', { method: 'POST', body: {}, headers: { 'x-zo-retry': '1' } });
  const retryUse = usageOf(retry);
  const afterRetry = await req(limitJar, '/api/auth/me');
  check(
    allowedAsk(retry.status) && retry.status !== 401 && retryUse.used === limit && afterRetry.data?.used === beforeRetry.data?.used,
    `x-zo-retry at used=${limit} allowed and not counted`,
  );

  const over = await req(limitJar, '/api/stream', { method: 'POST', body: {} });
  const body = over.data && typeof over.data === 'object' ? over.data : {};
  check(
    over.status === 401 && body.need_signin === true && body.used === limit && body.limit === limit && body.remaining === 0 && body.signedIn === false && body.reason === 'device',
    `ask ${limit + 1} → 401 used=${body.used} limit=${body.limit} remaining=${body.remaining} reason=${body.reason}`,
  );
  const meOver = await req(limitJar, '/api/auth/me');
  check(
    meOver.data?.used === body.used && meOver.data?.limit === body.limit && meOver.data?.remaining === body.remaining && meOver.data?.signedIn === body.signedIn,
    '/api/auth/me matches the 401 usage',
  );

  const fresh = new Jar('203.0.113.21');
  const again = await req(fresh, '/api/stream', { method: 'POST', body: {} });
  const freshUse = usageOf(again);
  check(allowedAsk(again.status) && freshUse.used === 1, `cleared cookie is a fresh device used=${freshUse.used}`);

  await testToken();

  const startA = await req(new Jar('203.0.113.22'), '/api/auth/start?return=%2Fwelcome');
  check(redirectAuth(startA), `start?return 302 → Google with same-origin callback status=${startA.status}`);
  check(await stateCarriesAuth('/welcome'), 'start?return state carries auth=ok / auth=error / new_user=1 return URLs');
  const startB = await req(new Jar('203.0.113.23'), '/api/auth/start?return_to=%2Fwelcome');
  check(redirectAuth(startB), `start?return_to 302 → Google with same-origin callback status=${startB.status}`);
  check(await stateCarriesAuth('/welcome'), 'start?return_to state carries auth return URLs');

  await signedInFlow();

  const ev = new Jar('203.0.113.50');
  const allow = await req(ev, '/api/events', { method: 'POST', body: { name: 'landing_view' } });
  check(allow.status === 204, 'allowlisted event → 204');
  const unknown = await req(ev, '/api/events', { method: 'POST', body: { name: 'not_a_real_event_zz' } });
  check(unknown.status === 204, 'unknown event → 204');
}

/** Start must 302 to Google consent with a same-origin Better Auth callback (auth=ok lands later, after consent). */
function redirectAuth(r) {
  if (r.status < 300 || r.status >= 400) return false;
  let url;
  try {
    url = new URL(r.headers.get('location') || '');
  } catch {
    return false;
  }
  if (url.hostname !== 'accounts.google.com') return false;
  return url.searchParams.get('redirect_uri') === `${new URL(BASE).origin}/api/auth/callback/google`;
}

/** Local only: the stored OAuth state carries callbackURL/errorURL with auth=ok / auth=error on the return path. */
async function stateCarriesAuth(returnPath) {
  if (!d1Name) return true;
  const rows = await d1Rows("SELECT value FROM verification ORDER BY createdAt DESC LIMIT 1");
  try {
    const v = JSON.parse(rows?.[0]?.value ?? '{}');
    const base = `${new URL(BASE).origin}${returnPath}`;
    return v.callbackURL === `${base}?auth=ok` && v.errorURL === `${base}?auth=error` && v.newUserURL === `${base}?auth=ok&new_user=1`;
  } catch {
    return false;
  }
}

async function testToken() {
  if (!token) {
    check(false, 'ZO_TEST_TOKEN_VALUE unset');
    return;
  }
  const jar = new Jar('203.0.113.30');
  const me0 = await req(jar, '/api/auth/me');
  let usersBefore = null;
  let usageBefore = null;
  if (d1Name) {
    try {
      usersBefore = await countTable('user');
      usageBefore = await countTable('usage');
    } catch (err) {
      check(false, `d1 count before token failed (${err instanceof Error ? err.message : 'error'})`);
    }
  }
  const one = await req(jar, '/api/stream', { method: 'POST', body: {}, headers: { 'x-zo-test-token': token } });
  const me1 = await req(jar, '/api/auth/me');
  check(allowedAsk(one.status) && one.status !== 401 && numHeader(one, 'x-zo-used') == null, 'test token skips the gate (no X-ZO-Used)');
  check(!jar.has('zo_sess'), 'test token sets no zo_sess');
  check(me0.data?.used === me1.data?.used, 'test token writes no usage');
  let limiterOk = true;
  for (let i = 0; i < 31; i++) {
    const r = await req(jar, '/api/stream', { method: 'POST', body: {}, headers: { 'x-zo-test-token': token } });
    if (r.status === 429 || r.status === 401 || jar.has('zo_sess')) limiterOk = false;
  }
  check(limiterOk, 'test token skips the per-minute limiter (31 asks, no 429, no session)');
  if (d1Name && usersBefore != null) {
    try {
      const usersAfter = await countTable('user');
      const usageAfter = await countTable('usage');
      check(usersAfter === usersBefore, 'test token creates no user');
      check(usageAfter === usageBefore, 'test token writes no usage row');
    } catch (err) {
      check(false, `d1 count after token failed (${err instanceof Error ? err.message : 'error'})`);
    }
  }
}

async function signedInFlow() {
  const jar = new Jar('203.0.113.40');
  const origin = new URL(BASE).origin;
  const anon = await req(jar, '/api/auth/sign-in/anonymous', { method: 'POST', body: {}, headers: { origin } });
  check((anon.status === 200 || anon.status === 204) && jar.has('zo_sess'), `anonymous sign-in sets zo_sess status=${anon.status}`);
  if (!jar.has('zo_sess')) return;
  if (!d1Name || !persist) {
    check(false, 'signed-in flip needs --d1-local and --persist');
    return;
  }
  try {
    await d1(`UPDATE user SET isAnonymous = 0 WHERE id = (SELECT id FROM user WHERE ifnull(isAnonymous, 0) != 0 ORDER BY createdAt DESC LIMIT 1)`);
  } catch (err) {
    check(false, `isAnonymous flip failed (${err instanceof Error ? err.message : 'error'})`);
    return;
  }
  const me = await req(jar, '/api/auth/me');
  check(me.status === 200 && me.data?.signedIn === true && me.data?.user?.id, 'flipped anonymous user is signed in');
  if (!me.data?.user) return;
  const usedBefore = me.data.used;

  const query = `e2e-gate-${Date.now()}`;
  const card = { title: 'E2E', body: [] };
  const created = await req(jar, '/api/saves', { method: 'POST', body: { query, title: 'E2E', card }, headers: { origin } });
  const id = created.data?.id;
  check(created.status === 201 && id != null, `POST /api/saves → 201 id=${id != null}`);
  const again = await req(jar, '/api/saves', { method: 'POST', body: { query, title: 'E2E', card }, headers: { origin } });
  check(again.status === 200 && id != null && String(again.data?.id) === String(id), 'same query → 200 same id');
  const list = await req(jar, '/api/saves');
  const items = Array.isArray(list.data?.items) ? list.data.items : [];
  check(list.status === 200 && id != null && items.some((item) => String(item.id) === String(id)), 'GET /api/saves lists the save');
  const one = await req(jar, `/api/saves/${encodeURIComponent(id)}`);
  check(one.status === 200 && one.data?.card != null && one.data?.query === query, 'GET /api/saves/:id returns the card');
  const deleted = await req(jar, `/api/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
  check(deleted.status === 204, 'DELETE /api/saves/:id → 204');
  const gone = await req(jar, `/api/saves/${encodeURIComponent(id)}`);
  check(gone.status === 404, 'GET deleted save → 404');
  const huge = { blob: 'x'.repeat(70 * 1024) };
  const tooBig = await req(jar, '/api/saves', { method: 'POST', body: { query: query + '-big', title: 'big', card: huge }, headers: { origin } });
  check(tooBig.status === 413, '70KB card → 413');
  const meSaves = await req(jar, '/api/auth/me');
  check(meSaves.data?.used === usedBefore, 'saves do not change usage');

  const prefs = await req(jar, '/api/account/prefs');
  check(prefs.status === 200 && prefs.data?.sync_history === false, 'GET prefs default sync_history false');
  const history = Array.from({ length: 60 }, (_, i) => `question ${i}`);
  const put = await req(jar, '/api/account/prefs', { method: 'PUT', body: { sync_history: true, history }, headers: { origin } });
  const stored = await req(jar, '/api/account/prefs');
  const capped = Array.isArray(stored.data?.history) ? stored.data.history.length : Array.isArray(put.data?.history) ? put.data.history.length : -1;
  check((put.status === 200 || put.status === 204) && stored.data?.sync_history === true && capped === 50, `PUT 60 history items capped to ${capped}`);
  const cleared = await req(jar, '/api/account/prefs', { method: 'PUT', body: { sync_history: false }, headers: { origin } });
  const afterClear = await req(jar, '/api/account/prefs');
  const left = Array.isArray(afterClear.data?.history) ? afterClear.data.history.length : -1;
  check((cleared.status === 200 || cleared.status === 204) && afterClear.data?.sync_history === false && left === 0, 'PUT sync_history false clears history');

  const ask = await req(jar, '/api/stream', { method: 'POST', body: {} });
  check(allowedAsk(ask.status) && numHeader(ask, 'x-zo-limit') === SIGNED_LIMIT, `signed-in X-ZO-Limit=${numHeader(ask, 'x-zo-limit')} equals GATE_SIGNED_PER_DAY=${SIGNED_LIMIT}`);

  const bye = await req(jar, '/api/auth/logout', { method: 'POST', headers: { origin } });
  const meOut = await req(jar, '/api/auth/me');
  check(bye.status === 204 && meOut.data?.user == null, 'logout 204 and /me user null');
}

async function main() {
  if (!BASE || (authFlag !== 'on' && authFlag !== 'off')) {
    console.log('FAIL usage: node scripts/e2e-gate.mjs <base> --auth=on|off [--d1-local=<dbname> --persist=<dir>]');
    process.exit(1);
  }
  if (Boolean(d1Name) !== Boolean(persist)) {
    console.log('FAIL --d1-local and --persist must be set together');
    process.exit(1);
  }
  const local = isLocalHost(BASE);
  if (authFlag === 'on' && !local) {
    console.log('FAIL auth=on is local only');
    process.exit(1);
  }
  token = loadToken(local);
  if (authFlag === 'off') await authOff(!local);
  else await authOn();
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.log(`FAIL ${redact(err instanceof Error ? err.message : 'error').slice(0, 200)}`);
  process.exit(1);
});
