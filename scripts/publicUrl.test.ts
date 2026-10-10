import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_ORIGIN, publicShareUrl } from '../shared/publicUrl.ts';

test('a share of the app is the pages.dev origin, including the trailing slash', () => {
  assert.equal(publicShareUrl('https://zo.page'), `${PUBLIC_ORIGIN}/`);
  assert.equal(publicShareUrl('https://zo.page/'), `${PUBLIC_ORIGIN}/`);
  assert.equal(publicShareUrl('https://zo2.pages.dev'), `${PUBLIC_ORIGIN}/`);
});

test('a shared question keeps its query and drops the old host', () => {
  assert.equal(publicShareUrl('https://zo.page/?q=Who%20is%20Ricky'), `${PUBLIC_ORIGIN}/?q=Who%20is%20Ricky`);
  assert.equal(publicShareUrl('https://b7766420.zo2.pages.dev/?q=rent'), `${PUBLIC_ORIGIN}/?q=rent`);
});

test('a broken href falls back to the public home', () => {
  assert.equal(publicShareUrl('not a url'), `${PUBLIC_ORIGIN}/`);
});
