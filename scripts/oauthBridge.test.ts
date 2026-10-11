import assert from 'node:assert/strict';
import { test } from 'node:test';
import { start } from '../server/auth/facade.ts';
import { signSessionToken } from '../server/auth/session.ts';
import { claim, finish, oauthBridgeStart, bridgeCallbackUrls, isPublicHost } from '../server/auth/oauthBridge.ts';
import type { Env } from '../server/util.ts';

function authEnv(kv?: KVNamespace): Env {
  return {
    AUTH_ENABLED: '1',
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret',
    SESSION_SECRET: '0123456789abcdef',
    DB: { prepare: () => ({}) },
    ENGINE_SKIP: kv,
  } as unknown as Env;
}

class MemoryKv {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

test('zo.fyi and www are the public hosts', () => {
  assert.equal(isPublicHost('zo.fyi'), true);
  assert.equal(isPublicHost('www.zo.fyi'), true);
  assert.equal(isPublicHost('zo2.pages.dev'), false);
});

test('public sign-in hops to the redirect Google already allows', () => {
  const loc = oauthBridgeStart(new URL('https://zo.fyi/api/auth/start?return=%2Fwelcome%3Fq%3Dtrains%23card&utm_source=fb&bridge=nope&next=https://evil.example'));
  const url = new URL(loc);
  assert.equal(url.origin, 'https://zo2.pages.dev');
  assert.equal(url.pathname, '/api/auth/start');
  assert.equal(url.searchParams.get('bridge'), '1');
  assert.equal(url.searchParams.get('return'), '/welcome?q=trains#card');
  assert.equal(url.searchParams.get('utm_source'), 'fb');
  assert.equal(url.searchParams.get('next'), null);
  assert.equal(url.searchParams.getAll('bridge').length, 1);
});

test('the Google callback on zo2 lands on finish, then zo.fyi', () => {
  const urls = bridgeCallbackUrls('/welcome?q=trains#card');
  assert.equal(urls.callbackURL, '/api/auth/finish?return=%2Fwelcome%3Fq%3Dtrains%23card&auth=ok');
  assert.match(urls.newUserCallbackURL, /new_user=1/);
  assert.match(urls.errorCallbackURL, /auth=error/);
  assert.equal(bridgeCallbackUrls('https://evil.example').callbackURL, '/api/auth/finish?return=%2F&auth=ok');
});

test('start on zo.fyi redirects before Google', async () => {
  const res = await start(new Request('https://zo.fyi/api/auth/start?return=%2Fanswers'), authEnv());
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location') || '');
  assert.equal(loc.origin, 'https://zo2.pages.dev');
  assert.equal(loc.searchParams.get('bridge'), '1');
  assert.equal(loc.searchParams.get('return'), '/answers');
});

test('finish without a session sends the browser back to zo.fyi with an error', async () => {
  const res = await finish(new Request('https://zo2.pages.dev/api/auth/finish?return=%2Fwelcome&auth=error&error=access_denied'), authEnv());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://zo.fyi/welcome?auth=error&error=access_denied');
});

test('finish hands a real session to zo.fyi and does not leave it in the url', async () => {
  const secret = '0123456789abcdef';
  const signed = await signSessionToken('sessiontokenvalue1234567890', secret);
  const kv = new MemoryKv();
  const env = authEnv(kv as unknown as KVNamespace);
  (env as { DB: unknown }).DB = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ id: 'user_1', email: 'ada@example.com', name: 'Ada', image: null, isAnonymous: 0 }),
      }),
    }),
  };
  const res = await finish(
    new Request('https://zo2.pages.dev/api/auth/finish?return=%2Fwelcome&auth=ok&new_user=1', {
      headers: { cookie: `__Secure-zo_sess=${encodeURIComponent(signed)}` },
    }),
    env,
  );
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location') || '');
  assert.equal(loc.origin, 'https://zo.fyi');
  assert.equal(loc.pathname, '/api/auth/claim');
  assert.equal(loc.searchParams.get('return'), '/welcome');
  assert.equal(loc.searchParams.get('new_user'), '1');
  const code = loc.searchParams.get('code') || '';
  assert.equal(loc.searchParams.has('session'), false);
  assert.equal(kv.store.get(`oauth-bridge:${code}`), signed);
  const claimed = await claim(new Request(loc), env);
  assert.equal(claimed.status, 302);
  assert.equal(claimed.headers.get('location'), 'https://zo.fyi/welcome?auth=ok&new_user=1');
  assert.match(claimed.headers.get('set-cookie') || '', new RegExp(`__Secure-zo_sess=${encodeURIComponent(signed)}`));
  assert.equal(kv.store.size, 0);
});

test('finish on the public host is not the Google callback', async () => {
  const res = await finish(new Request('https://zo.fyi/api/auth/finish?return=%2F'), authEnv());
  assert.equal(res.status, 404);
});

test('claim sets the session cookie once and forgets the code', async () => {
  const kv = new MemoryKv();
  const session = 'tok_abcdefghijklmnopqrstuvwxyz.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  kv.store.set('oauth-bridge:abcdefghijklmnopqrstuvwxyz0123456789ABCD', session);
  const env = authEnv(kv as unknown as KVNamespace);
  const req = new Request('https://zo.fyi/api/auth/claim?code=abcdefghijklmnopqrstuvwxyz0123456789ABCD&return=%2Fwelcome%3Fq%3D1%23card&new_user=1');
  const res = await claim(req, env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://zo.fyi/welcome?q=1&auth=ok&new_user=1#card');
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /^__Secure-zo_sess=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(kv.store.size, 0);
  const again = await claim(req, env);
  assert.equal(again.headers.get('set-cookie'), null);
  assert.match(again.headers.get('location') || '', /auth=error/);
});

test('www claim moves to the apex before the code is spent', async () => {
  const kv = new MemoryKv();
  kv.store.set('oauth-bridge:abcdefghijklmnopqrstuvwxyz0123456789ABCD', 'tok_abcdefghijklmnopqrstuvwxyz.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  const res = await claim(new Request('https://www.zo.fyi/api/auth/claim?code=abcdefghijklmnopqrstuvwxyz0123456789ABCD&return=%2F'), authEnv(kv as unknown as KVNamespace));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://zo.fyi/api/auth/claim?code=abcdefghijklmnopqrstuvwxyz0123456789ABCD&return=%2F');
  assert.equal(kv.store.size, 1);
});
