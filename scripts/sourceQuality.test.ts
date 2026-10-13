import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { finishQuality, hostTier, latinQuery, preferSources } from '../server/sourceQuality.ts';

const hit = (domain: string, title: string, snippet = title) => ({ url: `https://${domain}/x`, domain, title, snippet });

test('an English question keeps Latin script and drops a free-host blog once better pages remain', () => {
  assert.equal(latinQuery('who is Marie Curie'), true);
  assert.equal(latinQuery('居里夫人是谁'), false);
  assert.equal(hostTier('en.wikipedia.org'), 0);
  assert.equal(hostTier('espn.com'), 0);
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
