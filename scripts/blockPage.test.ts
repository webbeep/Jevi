import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockPage, readable, rememberBlocked, tidyBibtex } from '../server/blockPage.ts';
import { candidates } from '../server/extract.ts';

const BAN = "Your IP address of 2a06:98c0:3600::103 has been blocked You have been redirected to this page because you are operating a crawler or automated fetches in violation of robots.txt. This ban is permanent unless you can convince us that it's a mistake. You can contact us at eprint-abuse on the domain iacr.org.";

test('ban, CAPTCHA and browser-check pages are not page text', () => {
  assert.equal(isBlockPage(BAN), true);
  assert.equal(isBlockPage('Just a moment... Checking if the site connection is secure. Enable JavaScript and cookies to continue'), true);
  assert.equal(isBlockPage('Our systems have detected unusual traffic from your computer network.'), true);
});

test('real pages, even ones about robots.txt, still read', () => {
  assert.equal(isBlockPage('It Takes Two: Proofs of Work for Fiat–Shamir. Benedikt Bünz and Jessica Chen, New York University. We show that proofs of work make Fiat–Shamir secure.'), false);
  assert.equal(isBlockPage(`A robots.txt file tells crawlers which pages they may visit. ${'Site owners use it to keep crawlers away from private areas. '.repeat(80)}`), false);
});

test('hosts that refuse bots are never read, and a host that served a ban is not asked again', () => {
  assert.equal(readable('https://eprint.iacr.org/2026/2326'), false);
  assert.equal(readable('https://scholar.google.com/citations?user=x'), false);
  assert.equal(readable('https://example.org/a'), true);
  rememberBlocked('https://example.org/a');
  assert.equal(readable('https://example.org/b'), false);
});

test('a BibTeX citation reads as title and authors', () => {
  const bib = 'misc{cryptoeprint:2026/2326, author = {Benedikt Bünz and Jessica Chen and Ziyi Guan}, title = {It Takes Two: Proofs of Work for Fiat–Shamir}, howpublished = {Cryptology ePrint Archive}}';
  assert.equal(tidyBibtex(bib), '“It Takes Two: Proofs of Work for Fiat–Shamir” by Benedikt Bünz, Jessica Chen and Ziyi Guan.');
  assert.equal(tidyBibtex('No citation here.'), 'No citation here.');
});

test('the no-model answer never quotes a ban page', () => {
  const row = { title: 'It Takes Two', url: 'https://eprint.iacr.org/2026/2326', snippet: 'It Takes Two: Proofs of Work for Fiat–Shamir. Benedikt Bünz, New York University.', domain: 'eprint.iacr.org', engines: ['web'], content: BAN };
  const texts = candidates({ query: 'q', results: [row], images: [], engines: [] } as never).map((c) => c.text);
  assert.ok(texts.length > 0);
  assert.ok(texts.every((t) => !/blocked|robots/i.test(t)), texts.join(' | '));
});
