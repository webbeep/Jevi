import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arxivToWork,
  dropStrayDois,
  hasCatalogCopy,
  isPaperAsk,
  mergeWorks,
  pickWorks,
  normalizeArxivId,
  paperAnchor,
  paperOnTopic,
  paperTopic,
  parseArxivFeed,
  withScholarly,
  workMatches,
  workToResult,
} from '../server/scholarly.ts';

test('SPD-C4: paper asks are detected, shopping and everyday asks are not', () => {
  for (const q of [
    'Give me 3 real peer-reviewed papers on sleep deprivation and working memory, with DOIs',
    'meta-analysis of creatine and cognition',
    'research papers about microplastics',
    'What does the research say about intermittent fasting and longevity?',
    'What did studies find about GLP-1 drugs and weight loss?',
    'Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs',
    'academic publications on climate attribution',
    'climate papers with PMC IDs',
    'papers on extreme weather attribution',
    'attention is all you need arxiv preprint',
    'an arXiv preprint on retrieval augmented generation',
  ]) assert.ok(isPaperAsk(q), q);
  for (const q of ['toilet paper on sale', 'best paper towels', 'wallpaper for iPhone', 'iPad Air vs iPad Pro for drawing, which one and how much?', 'Fact-check: Gmail lets you attach files up to 50 MB', 'newspaper headlines today', 'Find the original paper that introduced the Transformer architecture: authors, venue and arXiv ID']) assert.ok(!isPaperAsk(q), q);
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
  assert.equal(paperTopic('Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs'), 'climate change extreme weather');
  assert.equal(paperTopic('an arXiv preprint on retrieval augmented generation'), 'retrieval augmented generation');
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
  assert.ok(hasCatalogCopy(r));
});

test('SPD-C4: Crossref items map onto the same source shape', async () => {
  const { crossrefToWork } = await import('../server/scholarly.ts');
  const r = workToResult(crossrefToWork({ DOI: '10.1111/j.1365-2869.2009.00799.x', title: ['Sleep deprivation impairs spatial working memory'], issued: { 'date-parts': [[2009, 3]] }, 'container-title': ['Journal of Sleep Research'], author: [{ given: 'C.', family: 'Kim' }], 'is-referenced-by-count': 157, abstract: '<jats:p>Sleep loss impairs memory.</jats:p>' }))!;
  assert.equal(r.url, 'https://doi.org/10.1111/j.1365-2869.2009.00799.x');
  assert.match(r.content!, /Published: 2009\. Venue: Journal of Sleep Research\. DOI: 10\.1111/);
  assert.match(r.content!, /Abstract: Sleep loss impairs memory\./);
});

test('an arXiv-only preprint becomes an arxiv.org source without a journal DOI', () => {
  const r = workToResult({
    arxivId: '1706.03762',
    title: 'Attention Is All You Need',
    publication_year: 2017,
    authorships: [{ author: { display_name: 'Ashish Vaswani' } }, { author: { display_name: 'Noam Shazeer' } }],
    primary_location: { source: { display_name: 'arXiv' } },
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
  })!;
  assert.equal(r.url, 'https://arxiv.org/abs/1706.03762');
  assert.equal(r.domain, 'arxiv.org');
  assert.match(r.snippet, /arXiv: 1706\.03762/);
  assert.match(r.content!, /Abstract: The dominant sequence/);
  assert.ok(hasCatalogCopy(r));
  assert.equal(normalizeArxivId('http://arxiv.org/abs/1706.03762v5'), '1706.03762');
  assert.equal(normalizeArxivId('arxiv:hep-th/9901001v1'), 'hep-th/9901001');
});

test('a DataCite arXiv DOI still points at arxiv.org', () => {
  const r = workToResult({ doi: '10.48550/arXiv.2312.00752', arxivId: '2312.00752', title: 'Mamba: Linear-Time Sequence Modeling', publication_year: 2023 })!;
  assert.equal(r.url, 'https://arxiv.org/abs/2312.00752');
  assert.equal(r.domain, 'arxiv.org');
  assert.match(r.content!, /arXiv: 2312\.00752/);
});

test('an Atom entry maps onto the same Work shape', () => {
  const xml = `<entry>
    <id>http://arxiv.org/abs/2005.11401v4</id>
    <title>Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</title>
    <published>2020-05-22T17:59:00Z</published>
    <summary>Large pre-trained language models have been shown to store factual knowledge.</summary>
    <author><name>Patrick Lewis</name></author>
    <author><name>Ethan Perez</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.48550/arXiv.2005.11401</arxiv:doi>
  </entry>`;
  const w = arxivToWork(xml);
  assert.equal(w.arxivId, '2005.11401');
  assert.equal(w.doi, '10.48550/arxiv.2005.11401');
  assert.equal(w.publication_year, 2020);
  assert.equal(w.authorships?.[0]?.author?.display_name, 'Patrick Lewis');
  const r = workToResult(w)!;
  assert.equal(r.url, 'https://arxiv.org/abs/2005.11401');
  const feed = parseArxivFeed(`<feed>${xml}</feed>`);
  assert.equal(feed.length, 1);
});

test('the same paper from OpenAlex and arXiv is kept once, DOI first', () => {
  const merged = mergeWorks([
    { via: 'openalex', works: [{ doi: '10.18653/v1/2020.acl-main.450', title: 'RAG', publication_year: 2020, cited_by_count: 900 }] },
    { via: 'arxiv', works: [{ arxivId: '2005.11401', doi: '10.18653/v1/2020.acl-main.450', title: 'RAG', publication_year: 2020, abstract: 'Large models.' }] },
  ]);
  assert.equal(merged.via, 'openalex+arxiv');
  assert.equal(merged.works.length, 1);
  assert.equal(merged.works[0]!.doi, '10.18653/v1/2020.acl-main.450');
  assert.equal(merged.works[0]!.arxivId, '2005.11401');
  assert.equal(merged.works[0]!.abstract, 'Large models.');
  const rows = merged.works.map((w) => workToResult(w)!);
  const web = [{ title: 'pdf', url: 'https://arxiv.org/pdf/2005.11401', snippet: '', domain: 'arxiv.org', engines: ['web'] }];
  assert.deepEqual(withScholarly(rows, web).map((x) => x.domain), ['doi.org']);
});

test('an arXiv/preprint ask leads with arXiv rows; a DOI ask still keeps a preprint slot', () => {
  const found = [
    { doi: '10.1/a', title: 'J1' },
    { doi: '10.1/b', title: 'J2' },
    { doi: '10.1/c', title: 'J3' },
    { doi: '10.1/d', title: 'J4' },
    { doi: '10.1/e', title: 'J5' },
    { arxivId: '1706.03762', title: 'Attention Is All You Need' },
    { arxivId: '2005.11401', title: 'Retrieval-Augmented Generation' },
  ];
  const papers = pickWorks(found, 'papers on transformers with DOIs');
  assert.equal(papers.length, 5);
  assert.equal(papers.filter((w) => w.arxivId && !w.doi).length, 2);
  assert.ok(papers.some((w) => w.arxivId === '1706.03762'));
  const pre = pickWorks(found, 'attention is all you need arxiv preprint');
  assert.equal(pre[0]?.arxivId, '1706.03762');
  assert.equal(pre.every((w) => w.arxivId), true);
  assert.equal(pre.some((w) => w.doi && !w.arxivId), false);
  const rag = { doi: '10.18653/v1/2020.acl-main.450', arxivId: '2005.11401', title: 'Retrieval-Augmented Generation' };
  assert.equal(pickWorks([rag, ...found], 'an arXiv preprint on retrieval augmented generation')[0]?.arxivId, '2005.11401');
  assert.equal(workToResult(rag, true)?.url, 'https://arxiv.org/abs/2005.11401');
  assert.equal(workToResult(rag)?.url, 'https://doi.org/10.18653/v1/2020.acl-main.450');
});
