import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diversify, namedSite } from '../server/diversify.ts';

const rows = (...domains: string[]) => domains.map((domain, i) => ({ domain, id: `${domain}#${i}` }));
const order = (list: { domain: string }[]) => list.map((r) => r.domain);

test('a site the person named goes first, at most 3, in order', () => {
  const list = rows('techdows.com', 'workspace.google.com', 'truehost.com', 'workspace.google.com', 'workspace.google.com', 'workspace.google.com', 'flamingo.run');
  assert.deepEqual(order(diversify('Find the official source for Google Workspace Business Starter pricing', list)), [
    'workspace.google.com', 'workspace.google.com', 'workspace.google.com',
    'techdows.com', 'truehost.com', 'workspace.google.com', 'flamingo.run',
  ]);
});

test('other domains keep at most 2 places up front; extras keep their order at the back', () => {
  const list = rows('who.int', 'who.int', 'who.int', 'who.int', 'iccp-portal.org', 'bjsm.bmj.com', 'who.int');
  const out = diversify('Find the primary source for the WHO recommendation on physical activity', list);
  assert.deepEqual(order(out), ['who.int', 'who.int', 'iccp-portal.org', 'bjsm.bmj.com', 'who.int', 'who.int', 'who.int']);
  assert.deepEqual(out.slice(4).map((r) => r.id), ['who.int#2', 'who.int#3', 'who.int#6']);
});

test('the named site is never capped', () => {
  const list = rows('postgresql.org', 'postgresql.org', 'postgresql.org', 'postgresql.org', 'postgresql.org', 'github.com', 'postgresql.org');
  assert.deepEqual(order(diversify('Fact-check: PostgreSQL MERGE has supported RETURNING since version 15', list)), order(list));
});

test('nothing is dropped or duplicated', () => {
  const list = rows('a.com', 'a.com', 'a.com', 'b.com', 'b.com', 'b.com', 'c.com', 'a.com');
  const out = diversify('anything at all', list);
  assert.equal(out.length, list.length);
  assert.deepEqual(new Set(out.map((r) => r.id)), new Set(list.map((r) => r.id)));
});

test('a list without repeats or named sites is unchanged', () => {
  const list = rows('whathifi.com', 'macrumors.com', 'theverge.com', 'cnet.com');
  assert.deepEqual(diversify('AirPods Pro 3 vs Sony WF-1000XM5 vs Bose QuietComfort Ultra', list), list);
});

test('named-site matching ignores stop words, short words and generic host labels', () => {
  const who = namedSite('WHO recommendation on how much exercise');
  assert.equal(who('who.int'), false); // "who" is a stop word
  const support = namedSite('support for docs in the store');
  assert.equal(support('support.apple.com'), false);
  assert.equal(support('docs.github.com'), false);
  const pg = namedSite('Summarize what changed for MERGE in the PostgreSQL 17 release notes');
  assert.equal(pg('postgresql.org'), true);
  assert.equal(pg('www.postgresql.org'), true);
  assert.equal(pg('manpages.debian.org'), false);
  const cf = namedSite('Summarize what this Cloudflare page says about CPU time limits');
  assert.equal(cf('developers.cloudflare.com'), true);
  assert.equal(namedSite('Kindle Paperwhite vs Kobo Clara BW')('kobo.com'), true);
});
