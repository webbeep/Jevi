import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAPER_ASK, dropStrayDois, paperAnchor, paperOnTopic, paperTopic, withScholarly, workMatches, workToResult } from '../server/scholarly.ts';

test('SPD-C4: paper asks are detected, shopping and everyday asks are not', () => {
  for (const q of ['Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs', 'meta-analysis of creatine and cognition', 'research papers about microplastics', 'What does the research say about intermittent fasting and longevity?']) assert.ok(PAPER_ASK.test(q), q);
  for (const q of ['toilet paper on sale', 'best paper towels', 'wallpaper for iPhone', 'iPad Air vs iPad Pro for drawing, which one and how much?', 'Fact-check: Gmail lets you attach files up to 50 MB', 'newspaper headlines today', 'Find the original paper that introduced the Transformer architecture: authors, venue and arXiv ID']) assert.ok(!PAPER_ASK.test(q), q);
});

test('a research DOI stays only when the paper is about the question', () => {
  const rows = [
    { title: 'GLP-1 receptor agonists and weight loss', url: 'https://www.thelancet.com/journals/lancet/article', snippet: 'A Lancet trial of semaglutide.' },
    { title: 'Unrelated peptide chemistry', url: 'https://doi.org/10.1000/2006.unrelated', snippet: 'DOI: 10.1000/2006.unrelated. Published 2006.' },
    { title: 'Semaglutide and body weight', url: 'https://doi.org/10.1016/S0140-6736(21)00213-0', snippet: 'GLP-1 weight loss in The Lancet.' },
  ];
  const kept = dropStrayDois('What does the research say about GLP-1 and weight loss?', rows);
  assert.equal(kept.some((row) => row.url.includes('2006')), false);
  assert.equal(kept.some((row) => row.url.includes('thelancet.com')), true);
  assert.equal(kept.some((row) => row.url.includes('10.1016')), true);
  assert.equal(paperOnTopic('What does the research say about GLP-1 and weight loss?', 'Unrelated peptide chemistry', ''), false);
});

test('SPD-C4: topic drops task words', () => {
  assert.equal(paperTopic('Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs'), 'sleep deprivation working memory');
  assert.equal(paperTopic('Find the original paper that introduced the Transformer architecture: authors, venue and arXiv ID'), 'Transformer architecture');
  assert.equal(paperTopic('What does the research say about intermittent fasting and longevity?'), 'intermittent fasting longevity');
});

test('a named author and year do not match a different year', () => {
  const anchor = paperAnchor('What did the Ekelund 2016 paper on physical activity find?');
  assert.deepEqual(anchor, { author: 'ekelund', year: 2016 });
  assert.equal(workMatches({ publication_year: 1967, authorships: [{ author: { display_name: 'Ulf Ekelund' } }] }, anchor!), false);
  assert.equal(workMatches({ publication_year: 2016, authorships: [{ author: { display_name: 'Ulf Ekelund' } }] }, anchor!), true);
  assert.equal(paperAnchor('peer-reviewed papers on GLP-1'), undefined);
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

test('SPD-C4: Crossref items map onto the same source shape', async () => {
  const { crossrefToWork } = await import('../server/scholarly.ts');
  const r = workToResult(crossrefToWork({ DOI: '10.1111/j.1365-2869.2009.00799.x', title: ['Sleep deprivation impairs spatial working memory'], issued: { 'date-parts': [[2009, 3]] }, 'container-title': ['Journal of Sleep Research'], author: [{ given: 'C.', family: 'Kim' }], 'is-referenced-by-count': 157, abstract: '<jats:p>Sleep loss impairs memory.</jats:p>' }))!;
  assert.equal(r.url, 'https://doi.org/10.1111/j.1365-2869.2009.00799.x');
  assert.match(r.content!, /Published: 2009\. Venue: Journal of Sleep Research\. DOI: 10\.1111/);
  assert.match(r.content!, /Abstract: Sleep loss impairs memory\./);
});
