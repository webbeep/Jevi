import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOwnSite, pickOrcid, pickOwnSite, RESEARCH_ASK, siteGuesses, withOwnSite } from '../server/ownSite.ts';
import type { SearchResult } from '../shared/types.ts';

const row = (url: string, title = 'Jessica Hamrick', snippet = ''): SearchResult => ({ url, title, snippet, domain: new URL(url).hostname, engines: ['web'] });

test('a domain under the person\'s name or a personal page host is their own site', () => {
  for (const url of ['https://www.jesshamrick.com/', 'https://jessicahamrick.com/about', 'https://jhamrick.com', 'https://hamrick.github.io/', 'https://sites.google.com/view/jessicahamrick', 'https://cs.berkeley.edu/~jhamrick/']) {
    assert.equal(isOwnSite('Jessica Hamrick', row(url)), true, url);
  }
});

test('profiles on shared sites and other people\'s domains are not', () => {
  for (const url of ['https://uk.linkedin.com/in/jessica-hamrick-4bab0811', 'https://scholar.google.com/citations?user=2ylcZSsAAAAJ', 'https://www.researchgate.net/profile/Jessica-Hamrick', 'https://disi.org/jessica-hamrick/', 'https://github.com/jhamrick', 'https://www.alphaxiv.org/@jessica-b-hamrick']) {
    assert.equal(isOwnSite('Jessica Hamrick', row(url)), false, url);
  }
  assert.equal(isOwnSite('Jessica Hamrick', row('https://www.jesshamrick.com/', 'Home', 'Welcome')), false, 'the row must name them');
});

test('guessed domains include the short first name', () => {
  assert.deepEqual(siteGuesses('Jessica Hamrick'), ['https://jessicahamrick.com/', 'https://jesshamrick.com/', 'https://jhamrick.com/']);
  assert.deepEqual(siteGuesses('Madonna'), []);
});

test('a guessed site counts only when it names the person and says what the results say about them', () => {
  const site = { url: 'https://www.jesshamrick.com/', title: 'Jess Hamrick', description: 'Research scientist at Google DeepMind', text: 'I am a research scientist at DeepMind working on model-based reasoning.' };
  const namesake = { url: 'https://jessicahamrick.com/', title: 'Jessica Hamrick Photography', description: 'Weddings in Ohio', text: 'Wedding and portrait photographer based in Columbus.' };
  assert.equal(pickOwnSite([namesake, site], 'Jessica Hamrick', ['deepmind', 'google'])?.url, 'https://www.jesshamrick.com/');
  assert.equal(pickOwnSite([namesake], 'Jessica Hamrick', ['deepmind']), undefined);
  assert.equal(pickOwnSite([site], 'Jessica Hamrick', []), undefined, 'no evidence, no site');
});

test('the ORCID record must be at an institution the results name', () => {
  const hits = [
    { 'orcid-id': '0000-0002-7207-2412', 'given-names': 'Jessica', 'family-names': 'Hamrick', 'institution-name': ['East Carolina University'] },
    { 'orcid-id': '0000-0002-3860-0429', 'given-names': 'Jessica', 'family-names': 'Hamrick', 'institution-name': ['DeepMind', 'Massachusetts Institute of Technology'] },
  ];
  assert.equal(pickOrcid(hits, 'Jessica Hamrick', ['google', 'deepmind'])?.['orcid-id'], '0000-0002-3860-0429');
  assert.equal(pickOrcid(hits, 'Jessica Hamrick', ['stanford']), undefined);
  assert.equal(pickOrcid(hits, 'Jess Hamrick', ['deepmind'])?.['orcid-id'], '0000-0002-3860-0429');
});

test('research asks are told apart from other person asks', () => {
  assert.equal(RESEARCH_ASK.test('Jessica Hamrick Google DeepMind research scientist'), true);
  assert.equal(RESEARCH_ASK.test('Ray Lee BlueFlame AI founder'), false);
});

test('the own site moves right after the lead row', () => {
  const rows = [row('https://a.org/x'), row('https://b.org/y'), row('https://www.jesshamrick.com/')];
  const placed = withOwnSite(rows, rows[2]!);
  assert.deepEqual(placed.rows.map((r) => r.url), ['https://a.org/x', 'https://www.jesshamrick.com/', 'https://b.org/y']);
  assert.equal(placed.n, 2);
  assert.equal(withOwnSite(rows, rows[0]!).n, 1);
});
