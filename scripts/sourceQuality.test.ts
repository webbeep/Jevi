import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { finishQuality, hasOfficialHit, hostTier, latinQuery, officialProbe, preferSources, sinkFormatWords, topicAuthorityAsk } from '../server/sourceQuality.ts';

const hit = (domain: string, title: string, snippet = title) => ({ url: `https://${domain}/x`, domain, title, snippet });

test('an English question keeps Latin script and drops a free-host blog once better pages remain', () => {
  assert.equal(latinQuery('who is Marie Curie'), true);
  assert.equal(latinQuery('居里夫人是谁'), false);
  assert.equal(hostTier('en.wikipedia.org'), 0);
  assert.equal(hostTier('espn.com'), 0);
  assert.equal(hostTier('files.dnr.state.mn.us'), 0);
  assert.equal(hostTier('www.fda.gov'), 0);
  assert.equal(hostTier('worldatlas.com'), 2);
  assert.equal(hostTier('cuadernodeaula.blogspot.com'), 3);
  assert.equal(hostTier('view.genially.com'), 3);
  const rows = [
    hit('cuadernodeaula.blogspot.com', 'Marie Curie biografia', 'Nació en Varsovia'),
    hit('view.genially.com', 'Marie Curie slides'),
    hit('sites.google.com', 'Marie Curie classroom'),
    hit('who2.com', 'Marie Curie facts'),
    hit('en.wikipedia.org', 'Marie Curie', 'Polish-French physicist and chemist'),
    hit('www.britannica.com', 'Marie Curie', 'Nobel Prize in Chemistry 1911'),
    hit('www.nobelprize.org', 'Marie Curie', 'The Nobel Prize in Physics 1903'),
    hit('www.nih.gov', 'Marie Curie', 'radioactivity'),
  ];
  const out = preferSources('who is Marie Curie', rows);
  assert.equal(out[0]?.domain, 'en.wikipedia.org');
  assert.equal(out.some((row) => row.domain.includes('blogspot')), false);
  assert.equal(out.some((row) => row.domain.includes('genially')), false);
  assert.ok(out.some((row) => row.domain === 'www.nobelprize.org'));
});

test('a Chinese score page drops once an official English scoreboard is in the list', () => {
  const rows = [
    hit('fsyyhong.com', 'NBA 比分', '未开始 独行侠 vs 火箭 北京时间'),
    hit('iaixiong.com', 'NBA 赛程', '76人 vs 凯尔特人'),
    hit('92canyin.com', '今日赛程', '热火 vs 森林狼'),
    hit('www.espn.com', 'NBA Scores', 'Mavericks 132, Rockets 115'),
    hit('www.nba.com', 'NBA Games', 'Magic at Cavaliers, Bucks at Hornets'),
    hit('www.cbssports.com', 'NBA scoreboard', 'Bulls at Nuggets'),
    hit('sports.yahoo.com', 'NBA scores', 'Sunday October 11'),
  ];
  const out = preferSources('NBA scores tonight', rows);
  assert.equal(out.some((row) => row.domain.endsWith('fsyyhong.com')), false);
  assert.equal(out[0]?.domain, 'www.espn.com');
  assert.ok(out.some((row) => row.domain === 'www.nba.com'));
});

test('a public page outranks a training page on the same site', () => {
  const primary = { url: 'https://www.example.gov/rest/about', domain: 'www.example.gov', title: 'About rest', snippet: 'The public guideline.' };
  const training = { url: 'https://www.example.gov/niosh/work-hour-training-for-nurses/longhours/mod2/08.html', domain: 'www.example.gov', title: 'Rest training module', snippet: 'A course page.' };
  const out = preferSources('What does the agency recommend for rest? Quote the public page', [training, primary, hit('www.nytimes.com', 'Rest feature')]);
  assert.equal(out[0]?.url, primary.url);
  assert.ok(out.findIndex((row) => row.url === primary.url) < out.findIndex((row) => row.url === training.url));
});

test('a spaced decimal stays one sentence when foreign sentences are dropped', () => {
  const quote = '"Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1. 5°C in the near term in considered scenarios."';
  const [node] = finishQuality('quote the official report', [{ type: 'text', text: quote }]);
  assert.equal(node?.type, 'text');
  if (node?.type !== 'text') return;
  assert.match(node.text, /reaching 1\.5°C/);
  assert.doesNotMatch(node.text, /reaching 1\.\s/);
});

test('a quotation cut at the point keeps the decimal stated on the same card', () => {
  const caption = '"Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1.';
  const [node] = finishQuality('quote the official report', [{ type: 'hero', value: '1.5°C', label: 'Best estimate', caption }]);
  assert.match(node?.type === 'hero' ? node.caption ?? '' : '', /reaching 1\.5°C"/);
});

test('an unpriced product hero does not lead a card that has a priced pick', () => {
  const nodes = finishQuality('Help me find an HDMI switch under $40', [
    { type: 'hero', value: 'Kinivo 550BN', label: 'Top pick' },
    { type: 'list', style: 'bullet', items: [{ text: 'Fosmon 3-Port', meta: '$13.99' }] },
  ]);
  assert.equal(nodes[0], undefined);
  assert.equal(nodes[1]?.type, 'list');
  const budgetLabel = finishQuality('best cordless stick vacuum under $200', [
    { type: 'hero', value: 'Acme Stick', label: 'Best cordless stick vacuum under $200' },
    { type: 'list', style: 'bullet', items: [{ text: 'Basic Stick', meta: '$140' }] },
  ]);
  assert.equal(budgetLabel[0], undefined);
  const chip = finishQuality('best cordless stick vacuum under $200', [
    { type: 'hero', value: 'Acme Stick', label: 'Best cordless stick vacuum under $200' },
    { type: 'actions', items: [{ label: 'Under $150 picks', query: 'Best cordless stick vacuum under $150', kind: 'search' }] },
  ]);
  assert.equal(chip[0]?.type, 'hero');
  const kept = finishQuality('How do HDMI switches work', [
    { type: 'hero', value: 'Kinivo 550BN', label: 'Top pick' },
    { type: 'list', style: 'bullet', items: [{ text: 'Fosmon 3-Port', meta: '$13.99' }] },
  ]);
  assert.equal(kept[0]?.type, 'hero');
});

test('a pick that misses a stated spec does not lead one that meets it', () => {
  const match = { url: 'https://shop.example/three', domain: 'shop.example', title: 'Acme 3-port switch', snippet: '$18.99' };
  const miss = { url: 'https://shop.example/five', domain: 'shop.example', title: 'Acme 5-port switch', snippet: '$21.00' };
  const rows = preferSources('best hdmi switch for 3 devices under $40', [miss, match]);
  assert.equal(rows[0]?.url, match.url);
  const nodes = finishQuality('best hdmi switch for 3 devices under $40', [
    { type: 'hero', value: '5-port switch', label: 'Top pick', caption: '$21.00' },
    { type: 'list', style: 'bullet', items: [{ text: '5-port switch', meta: '$21.00' }, { text: '3-port switch', meta: '$18.99' }] },
  ]);
  assert.equal(nodes[0], undefined);
  const items = nodes[1]?.type === 'list' ? nodes[1].items.map((item) => item.text) : [];
  assert.equal(items[0], '3-port switch');
});

test('a priced pick that lacks a stated feature does not stay once another pick has it', () => {
  const nodes = finishQuality('a keyboard under $40 that is hot-swappable', [
    {
      type: 'stack',
      children: [
        { type: 'tile', label: 'Acme board', value: '$25', sub: 'wireless gasket mount' },
        { type: 'tile', label: 'North board', value: '$32', sub: 'hot-swappable linear switches' },
      ],
    },
  ]);
  const stack = nodes.find((node) => node?.type === 'stack');
  const labels = stack?.type === 'stack'
    ? stack.children.flatMap((child) => (child.type === 'tile' ? [child.label] : []))
    : [];
  assert.deepEqual(labels, ['North board']);
});

test('a priced product page leads an unpriced one on a shopping ask', () => {
  const priced = { url: 'https://shop.example/switch', domain: 'shop.example', title: 'Acme HDMI switch', snippet: '3 ports, $18.99' };
  const bare = { url: 'https://blog.example/roundup', domain: 'blog.example', title: 'HDMI switch roundup', snippet: 'Several switches, prices vary' };
  const out = preferSources('best hdmi switch under $40', [bare, priced, hit('www.nytimes.com', 'Cable news')]);
  assert.equal(out[0]?.url, priced.url);
});

test('a shopping ask keeps a forum post that can carry the product photo', () => {
  const rows = [
    hit('www.runnersworld.com', 'Best running shoes for beginners'),
    hit('www.reddit.com', 'Brooks Ghost 18', 'Daily trainer, about $140'),
    hit('www.nytimes.com', 'Best running shoes'),
    hit('runrepeat.com', 'Best beginner running shoes'),
    hit('www.rtings.com', 'Best running shoes'),
  ];
  const out = preferSources('best running shoes for beginners', rows);
  assert.ok(out.some((row) => row.domain.includes('reddit')));
});

test('a research question leads with papers and a social post does not outrank an official page', () => {
  const rows = [
    hit('www.reddit.com', 'Fasting thread', 'I tried intermittent fasting'),
    hit('www.youtube.com', 'Fasting explained', 'A video about fasting and longevity'),
    hit('www.nad.com', '16-hour fasting', 'A news recap of a mouse study'),
    hit('pmc.ncbi.nlm.nih.gov', 'Intermittent fasting, longevity and disease', 'A review of the evidence'),
    hit('doi.org', 'Time-restricted feeding and lifespan', 'Journal article'),
    hit('www.nature.com', 'Fasting and ageing', 'Nature paper'),
  ];
  const out = preferSources('What does the research say about intermittent fasting and longevity?', rows);
  assert.equal(out.some((row) => row.domain.includes('reddit')), false);
  assert.ok(['pmc.ncbi.nlm.nih.gov', 'doi.org', 'www.nature.com'].includes(out[0]?.domain ?? ''));
  assert.ok(out.findIndex((row) => row.domain.includes('youtube')) > out.findIndex((row) => row.domain === 'doi.org'));
});

test('a named body leads, and a newer official page leads an old release', () => {
  const ipcc = preferSources('What does the IPCC say about warming?', [
    hit('www.newyorker.com', 'The climate issue', 'A magazine essay'),
    hit('www.ipcc.ch', 'AR6 Synthesis Report', 'The latest assessment'),
    hit('www.nytimes.com', 'Climate report', 'News coverage'),
    hit('www.bbc.com', 'IPCC report', 'Summary'),
  ]);
  assert.equal(ipcc[0]?.domain, 'www.ipcc.ch');
  const wolves = preferSources('How many wolves live in Minnesota?', [
    hit('www.mprnews.org', 'Wolf count', 'About 2,900'),
    hit('files.dnr.state.mn.us', 'Wolf survey', 'The population estimate'),
    hit('www.startribune.com', 'Wolves', 'Local news'),
    hit('www.duluthnewstribune.com', 'Wolves', 'Local news'),
  ]);
  assert.equal(wolves[0]?.domain, 'files.dnr.state.mn.us');
  const milk = preferSources('Is raw milk legal according to the FDA?', [
    hit('www.fda.gov', 'FDA 2007 release', 'A 2007 press release on raw milk'),
    hit('www.fda.gov', 'Raw milk questions', 'Current consumer page'),
    hit('www.nytimes.com', 'Raw milk', 'A feature'),
    hit('www.cdc.gov', 'Raw milk', 'Risks'),
  ]);
  assert.equal(milk[0]?.title, 'Raw milk questions');
});

test('a named agency and a state count get an official-site search', () => {
  const ipcc = officialProbe('What does the IPCC say is the likely global temperature increase by 2100?');
  assert.match(ipcc, /site:ipcc\./);
  assert.equal(hasOfficialHit('What does the IPCC say is the likely global temperature increase by 2100?', [
    { domain: 'www.nytimes.com', url: 'https://www.nytimes.com/climate' },
  ]), false);
  assert.equal(hasOfficialHit('What does the IPCC say is the likely global temperature increase by 2100?', [
    { domain: 'www.ipcc.ch', url: 'https://www.ipcc.ch/report' },
  ]), true);
  const sleep = 'How much sleep do adults need according to the CDC? Quote the exact line from the CDC page';
  assert.equal(hasOfficialHit(sleep, [
    { domain: 'www.cdc.gov', url: 'https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod2/08.html', title: 'NIOSH training' },
  ]), false);
  assert.equal(hasOfficialHit(sleep, [
    { domain: 'www.cdc.gov', url: 'https://www.cdc.gov/sleep/about/index.html', title: 'About sleep' },
  ]), true);
  const probe = officialProbe(sleep);
  assert.match(probe, /site:cdc\.gov/);
  assert.match(probe, /sleep adults need/);
  assert.doesNotMatch(probe, /\bquote\b/i);
  const wolves = officialProbe('How many wolves live in Minnesota?');
  assert.match(wolves, /site:mn\.us|site:mn\.gov/);
  const outbreak = officialProbe('How many cases in the FDA outbreak?');
  assert.match(outbreak, /site:fda\./);
  const lakes = officialProbe('How many lakes are in Minnesota?');
  assert.match(lakes, /site:mn\.us|site:mn\.gov/);
  const lakeCount = officialProbe('Minnesota lake count');
  assert.match(lakeCount, /site:mn\.us|site:mn\.gov/);
  const journal = officialProbe('What did The Lancet report on GLP-1 and weight loss?');
  assert.match(journal, /site:thelancet\.com/);
  assert.doesNotMatch(journal, /site:glp\./);
  assert.equal(officialProbe('What did studies find about GLP-1 drugs and weight loss?'), '');
  const count = officialProbe('How many foodborne outbreak cases were confirmed last year?');
  assert.match(count, /site:\.gov/);
  const fee = officialProbe('What is the renewal fee for a harbor permit?');
  assert.match(fee, /site:\.gov/);
});

test('government, a journal of record, and a state page lead a count or a paper ask', () => {
  const lakes = preferSources('How many lakes are in Minnesota?', [
    hit('www.worldatlas.com', 'Minnesota lakes', 'Thousands of lakes'),
    hit('www.onlyinyourstate.com', 'Minnesota lake list', 'A travel roundup'),
    hit('files.dnr.state.mn.us', 'Minnesota lake census', 'The official count'),
    hit('www.startribune.com', 'Lakes', 'Local news'),
  ]);
  assert.equal(lakes[0]?.domain, 'files.dnr.state.mn.us');
  const outbreak = preferSources('How many cases in the FDA outbreak?', [
    hit('www.foodsafetynews.com', 'Outbreak roundup', 'A blog count'),
    hit('www.cidrap.umn.edu', 'Outbreak news', 'A recap'),
    hit('www.fda.gov', 'Outbreak investigation', 'The agency count'),
    hit('www.nytimes.com', 'Outbreak', 'News coverage'),
  ]);
  assert.equal(outbreak[0]?.domain, 'www.fda.gov');
  const published = preferSources('How many people were sickened in the recent foodborne outbreak?', [
    hit('www.fda.gov', 'Agency update', 'According to the CDC, illnesses were reported across several states'),
    hit('www.nytimes.com', 'Outbreak news', 'A news recap of the illnesses'),
    hit('www.cdc.gov', 'Outbreak investigation', 'The agency is publishing the case count'),
    hit('www.usda.gov', 'Food safety note', 'A summary of the investigation'),
  ]);
  assert.equal(published[0]?.domain, 'www.cdc.gov');
  const lancet = preferSources('What did studies find about GLP-1 drugs and weight loss?', [
    hit('www.healthline.com', 'GLP-1 recap', 'A consumer recap'),
    hit('www.thelancet.com', 'Semaglutide trial', 'The Lancet trial'),
    hit('www.webmd.com', 'Weight loss drugs', 'A explainer'),
    hit('www.cnn.com', 'Ozempic', 'News coverage'),
  ]);
  assert.equal(lancet[0]?.domain, 'www.thelancet.com');
});

test('a preprint ask leads with arxiv.org; a DOI ask still leads with the journal', () => {
  const rows = [
    hit('doi.org', 'Nursing RAG', 'A journal article'),
    hit('doi.org', 'RAG notes', 'Another DOI'),
    hit('arxiv.org', 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', 'arXiv:2005.11401'),
    hit('pmc.ncbi.nlm.nih.gov', 'RAG review', 'A PMC paper'),
  ];
  const pre = preferSources('an arXiv preprint on retrieval augmented generation', rows);
  assert.equal(pre[0]?.domain, 'arxiv.org');
  const again = preferSources('an arXiv preprint on retrieval augmented generation', [
    hit('www.fda.gov', 'An agency page', 'Not a preprint'),
    ...rows,
  ]);
  assert.equal(again[0]?.domain, 'arxiv.org');
  assert.equal(again[0]?.title, 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks');
  const climate = preferSources('Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs', [
    hit('climatecommunication.yale.edu', 'How to communicate', 'A recap'),
    hit('doi.org', 'Extreme events', 'A journal article'),
    hit('pmc.ncbi.nlm.nih.gov', 'Climate health', 'A PMC paper'),
    hit('arxiv.org', 'A climate preprint', 'arXiv'),
  ]);
  assert.ok(['doi.org', 'pmc.ncbi.nlm.nih.gov'].includes(climate[0]?.domain ?? ''));
  const glp = preferSources('What did studies find about GLP-1 drugs and weight loss?', [
    hit('www.healthline.com', 'GLP-1 recap', 'A consumer recap'),
    hit('doi.org', 'Semaglutide trial', 'Journal article'),
    hit('pmc.ncbi.nlm.nih.gov', 'Weight loss review', 'PMC'),
  ]);
  assert.ok(['doi.org', 'pmc.ncbi.nlm.nih.gov'].includes(glp[0]?.domain ?? ''));
});

test('a list that is only foreign pages is kept', () => {
  const rows = [hit('fsyyhong.com', 'NBA 比分', '未开始 独行侠'), hit('iaixiong.com', '赛程', '火箭')];
  assert.equal(preferSources('NBA scores tonight', rows).length, 2);
});

test('a Spanish sentence and a settled disagreement leave the card, and a repeated game does not', () => {
  const nodes: CardNode[] = [
    { type: 'text', text: 'She won the 1911 Nobel Prize in Chemistry. Nació en Varsovia en 1867 y se trasladó a París en 1891 para estudiar en la Sorbona, donde se convirtió en la primera mujer profesora.' },
    { type: 'callout', text: 'Sources disagree on the year of the Nobel Prize in Chemistry: some results say 1911, others say 1910.' },
    { type: 'tile', label: 'Nobel Prizes', value: '2', sub: 'Physics 1903 · Chemistry 1911' },
    {
      type: 'table',
      columns: ['Time', 'Game'],
      rows: [
        ['08:00', '76ers vs Celtics'],
        ['08:00', '76ers vs Celtics'],
        ['18:00', 'Mavericks vs Rockets'],
      ],
    },
    { type: 'steps', items: [{ title: '1. Instructions' }, { title: '2. Cells read them' }, { title: '4. The body remembers' }] },
  ];
  const out = finishQuality('who is Marie Curie', nodes);
  assert.match(out[0] && out[0].type === 'text' ? out[0].text : '', /1911/);
  assert.doesNotMatch(out[0] && out[0].type === 'text' ? out[0].text : '', /Varsovia/);
  assert.equal(out[1], undefined);
  assert.equal(out[3]?.type === 'table' ? out[3].rows.length : 0, 2);
  assert.deepEqual(out[4]?.type === 'steps' ? out[4].items.map((step) => step.title) : [], ['1. Instructions', '2. Cells read them', '3. The body remembers']);
});

test('a long clause is said once', () => {
  const line = 'A network built solely on attention mechanisms, dispensing with recurrence and convolutions entirely.';
  const nodes: CardNode[] = [
    { type: 'hero', value: 'Transformer', caption: line },
    { type: 'text', text: `The paper proposed the Transformer, a network architecture ${line}` },
    { type: 'text', text: `The Transformer is ${line.charAt(0).toLowerCase()}${line.slice(1)} Self-attention has been used for reading.` },
  ];
  const out = finishQuality('what did the paper find', nodes);
  const texts = out.flatMap((node) => {
    if (!node) return [];
    if (node.type === 'text') return [node.text];
    if (node.type === 'hero') return [node.caption ?? ''];
    return [];
  }).join(' ');
  const hits = texts.toLowerCase().split('dispensing with recurrence').length - 1;
  assert.equal(hits, 1);
  assert.match(texts, /Self-attention has been used/);
});

test('a card that says the person is not named drops another person\'s roles', () => {
  const nodes: CardNode[] = [
    { type: 'text', text: 'No source names that person.' },
    { type: 'tile', label: 'Role', value: 'COO' },
    { type: 'stat', label: 'Credential', value: 'CFA' },
  ];
  const out = finishQuality('who is the person', nodes).filter(Boolean);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.type, 'text');
});

test('a verdict names a model the table compares, and a clinic blurb is not a paper', () => {
  const nodes: CardNode[] = [
    { type: 'table', columns: ['Factor', 'Levoit LVAC-300', 'Dyson V11'], rows: [['Price', '$350', '$584']] },
    { type: 'text', text: 'Verdict. For one dog and hardwood, the Dyson V15 Detect is the pick.' },
    { type: 'list', style: 'number', items: [{ text: 'Langer et al. 2026, DOI 10.1001/jama.2026.0287' }, { text: 'GLP-1 Medications and Muscle Loss: What to Know. Mayo Clinic.' }] },
  ];
  const out = finishQuality('List peer-reviewed papers on GLP-1 and recommend a vacuum', nodes);
  assert.match(out[1] && out[1].type === 'text' ? out[1].text : '', /V11/);
  assert.doesNotMatch(out[1] && out[1].type === 'text' ? out[1].text : '', /V15/);
  const items = out[2] && out[2].type === 'list' ? out[2].items : [];
  assert.equal(items.length, 1);
  assert.match(items[0]?.text ?? '', /Langer/);
});

test('a news ask leads with newsrooms, not a newsletter or an encyclopedia', () => {
  const row = (domain: string, title: string) => ({ url: `https://${domain}/x`, title, domain, snippet: '' });
  const rows = [
    row('tldr.tech', 'TLDR Newsletter'),
    row('en.wikipedia.org', 'Portal:Current events'),
    row('youtube.com', 'Top headlines this morning'),
    row('apnews.com', 'AP News: Top stories today'),
    row('euronews.com', 'Latest news bulletin'),
  ];
  const ranked = preferSources('news tldr today', rows).map((r) => r.domain);
  assert.deepEqual(ranked.slice(0, 2), ['apnews.com', 'euronews.com']);
  assert.deepEqual(preferSources('apple pie recipe', rows).map((r) => r.domain), rows.map((r) => r.domain));
});

test('a word the rewrites left out sinks the rows named after it', () => {
  const row = (domain: string, title: string) => ({ url: `https://${domain}/x`, title, domain, snippet: '' });
  const rows = [row('tldr.tech', 'TLDR Newsletter'), row('thecorenews.substack.com', 'The Core: Apple; TLDR, Oct. 15'), row('nytimes.com', 'Top news today'), row('euronews.com', 'Latest news bulletin')];
  const rewrites = ['top news headlines October 15 2026', "today's top stories October 15 2026"];
  assert.deepEqual(sinkFormatWords('news tldr today', rewrites, rows).map((r) => r.domain), ['nytimes.com', 'euronews.com', 'tldr.tech', 'thecorenews.substack.com']);
  assert.deepEqual(sinkFormatWords('nba scores tonight', ['NBA scores October 15 2026'], rows).map((r) => r.domain), rows.map((r) => r.domain));
  assert.deepEqual(sinkFormatWords('news tldr today', [], rows), rows);
  const many = [...rows, row('apnews.com', 'AP top stories'), row('bbc.com', 'BBC News'), row('wkrn.com', "Today's top stories")];
  assert.deepEqual(sinkFormatWords('news tldr today', rewrites, many).map((r) => r.domain), ['nytimes.com', 'euronews.com', 'apnews.com', 'bbc.com', 'wkrn.com']);
});

test('a topic with a known US authority probes that authority when the ask names none', () => {
  const aspirin = 'Should I start taking a daily low-dose aspirin?';
  const probe = officialProbe(aspirin);
  assert.match(probe, /site:uspreventiveservicestaskforce\.org/);
  assert.match(probe, /aspirin/);
  assert.equal(hasOfficialHit(aspirin, [{ domain: 'www.healthline.com', url: 'https://www.healthline.com/aspirin' }]), false);
  assert.equal(hasOfficialHit(aspirin, [{ domain: 'www.uspreventiveservicestaskforce.org', url: 'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/aspirin' }]), true);
  // An NIH news page reports the task force's rule; the task force's own page is still worth the short wait.
  assert.equal(hasOfficialHit(aspirin, [{ domain: 'newsinhealth.nih.gov', url: 'https://newsinhealth.nih.gov/2018/11/daily-aspirin' }]), false);
  assert.match(officialProbe('Should I rinse raw chicken before cooking?'), /site:fsis\.usda\.gov/);
  assert.match(officialProbe('What is the Roth IRA contribution limit?'), /site:irs\.gov/);
  assert.match(officialProbe('What happens if the president does a pocket veto?'), /site:congress\.gov/);
  // A name, a film screening and an agency the ask names are not these topics.
  assert.equal(officialProbe('Who is Ira Glass married to?'), '');
  assert.equal(topicAuthorityAsk('Should I rinse raw chicken before I cook it?'), true);
  assert.equal(topicAuthorityAsk('What does the CDC say about raw chicken?'), false);
  assert.equal(topicAuthorityAsk('Best budget headphones'), false);
  assert.equal(officialProbe('Dune screening times tonight'), '');
  assert.doesNotMatch(officialProbe('What does the WHO say about aspirin?'), /uspreventiveservicestaskforce/);
  // Who is asking drops out, and the topic word survives the cut.
  const long = officialProbe("I'm 65 with no heart disease. Should I start taking a daily low-dose aspirin to prevent a heart attack?");
  assert.match(long, /aspirin/);
  assert.doesNotMatch(long, /\b(?:I|m|Should|start)\b/);
  assert.match(officialProbe('Step by step, how do I renew my US passport by mail?'), /^renew passport mail /);
  // A job title or a currency is not an agency.
  assert.equal(officialProbe('Bitcoin price in USD'), '');
  assert.doesNotMatch(officialProbe('Who is the CEO of the IRS?'), /site:ceo\./);
  // A city or the national portal is a body with its own site.
  assert.match(officialProbe('NYC sales tax rate'), /site:nyc\./);
});

test('at most two Wikipedia pages lead; the rest go to the back', () => {
  const ranked = preferSources('Who directed the most Oscar-winning films?', [
    hit('en.wikipedia.org', 'Academy Award for Best Director', 'List'),
    hit('en.wikipedia.org', 'List of Academy Award records', 'Records'),
    hit('en.wikipedia.org', 'List of directors', 'Directors'),
    hit('www.oscars.org', 'Oscars history', 'Official'),
    hit('www.imdb.com', 'Most Oscar wins', 'Lists'),
    hit('www.britannica.com', 'Academy Awards', 'Encyclopedia'),
  ]);
  assert.equal(ranked.slice(0, 5).filter((row) => row.domain === 'en.wikipedia.org').length, 2);
  assert.equal(ranked.at(-1)?.title, 'List of directors');
  assert.equal(ranked.length, 6);
});

test('of a topic\'s authorities, the one that sets the rule leads', () => {
  const ranked = preferSources('Should I start taking a daily low-dose aspirin?', [
    hit('newsinhealth.nih.gov', 'Daily aspirin may not benefit healthy older adults', 'News'),
    hit('www.nih.gov', 'Daily aspirin shows no benefit', 'News release'),
    hit('www.uspreventiveservicestaskforce.org', 'Recommendation: Aspirin Use to Prevent Cardiovascular Disease', 'Grade D for adults 60 or older'),
    hit('www.mayoclinic.org', 'Daily aspirin therapy', 'Overview'),
  ]);
  assert.equal(ranked[0]?.domain, 'www.uspreventiveservicestaskforce.org');
});
