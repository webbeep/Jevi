import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAPER_ASK, paperTopic, withScholarly, workToResult } from '../server/scholarly.ts';

test('SPD-C4: paper asks are detected, shopping and everyday asks are not', () => {
  for (const q of ['Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs', 'meta-analysis of creatine and cognition', 'research papers about microplastics']) assert.ok(PAPER_ASK.test(q), q);
  for (const q of ['toilet paper on sale', 'best paper towels', 'wallpaper for iPhone', 'iPad Air vs iPad Pro for drawing, which one and how much?', 'Fact-check: Gmail lets you attach files up to 50 MB', 'newspaper headlines today', 'Find the original paper that introduced the Transformer architecture: authors, venue and arXiv ID']) assert.ok(!PAPER_ASK.test(q), q);
});

test('SPD-C4: topic drops task words', () => {
  assert.equal(paperTopic('Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs'), 'sleep deprivation working memory');
  assert.equal(paperTopic('Find the original paper that introduced the Transformer architecture: authors, venue and arXiv ID'), 'Transformer architecture');
});

test('SPD-C4: a work becomes a doi.org source that states its DOI and year; web dupes of that DOI go', () => {
  const r = workToResult({ doi: 'https://doi.org/10.1523/jneurosci.0007-04.2004', title: 'Functional Imaging of Working Memory after 24 Hr of Total Sleep Deprivation', publication_year: 2004, cited_by_count: 511, authorships: [{ author: { display_name: 'Michael W.L. Chee' } }], primary_location: { source: { display_name: 'Journal of Neuroscience' } }, abstract_inverted_index: { Sleep: [0], deprivation: [1] } })!;
  assert.equal(r.url, 'https://doi.org/10.1523/jneurosci.0007-04.2004');
  assert.equal(r.engines[0], 'web');
  assert.match(r.content!, /DOI: 10\.1523\/jneurosci\.0007-04\.2004/);
  assert.match(r.content!, /Published: 2004/);
  assert.match(r.content!, /Abstract: Sleep deprivation/);
  const web = [{ title: 'x', url: 'https://www.jneurosci.org/doi/10.1523/jneurosci.0007-04.2004', snippet: '', domain: 'jneurosci.org', engines: ['web'] }, { title: 'y', url: 'https://example.com/a', snippet: '', domain: 'example.com', engines: ['web'] }];
  assert.deepEqual(withScholarly([r], web).map((x) => x.domain), ['doi.org', 'example.com']);
  assert.equal(workToResult({ title: 'no doi' }), undefined);
});
