import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignFactProse, factAnswer, hopQueries, nextHop, patchFactLead, placeFactLead, unsupportedYear } from '../server/hops.ts';
import { bindClaims, type ClaimSource } from '../server/claims.ts';
import type { CardNode } from '../shared/card.ts';

const AGE = 'How old was Stephen Baldwin when Hailey and Justin got married?';
const YEAR = "What year did Yohji Yamamoto's mother sell her dressmaking shop?";
const SCORE = "What's the current Tomatometer score of the most recent season of The Lord of the Rings: The Rings of Power on Rotten Tomatoes?";
const WALLS = "If the Great North Run took place on York's Medieval Walls how many circuits of them would the athletes run? Round to the nearest tenth of a circuit.";
const PARK = 'What attraction in Walt Disney World opened exactly 50 years after the theme park originally opened?';
const CUP = 'Who was team captain of the team that won the Stanley Cup the year Connor McDavid was born?';
const CENTURY = 'The September Declaration has a rough equivalent in the Netherlands that takes place on the same day every year. In what century was the current name of this day (as of August 2024) chosen?';

test('an age question searches the birth date and the event date', () => {
  const hops = hopQueries(AGE);
  assert.match(hops[0] ?? '', /Stephen Baldwin date of birth/);
  assert.match(hops[1] ?? '', /Hailey and Justin got married date/);
});

test('the age is the subject’s age at the earliest sourced event date', () => {
  const corpus = [
    'Hailey Baldwin was born November 22, 1996.',
    'Stephen Baldwin was born May 12, 1966.',
    'Hailey Baldwin and Justin Bieber married on September 13, 2018.',
    'Their wedding ceremony was held on September 30, 2019.',
    'Hailey was 22.',
  ].join(' ');
  const answer = factAnswer(AGE, corpus);
  assert.equal(answer?.lead, '52');
});

test('a what-year question looks past the host that never states the year', () => {
  const corpus = 'Yohji Yamamoto was born in 1943. His mother opened a dressmaking shop in Kabukicho.';
  const next = nextHop(YEAR, corpus, { hosts: ['en.wikipedia.org'] });
  assert.match(next ?? '', /sold her dressmaking shop year/i);
  assert.equal(factAnswer(YEAR, 'She sold the dressmaking shop in 1972 to fund the launch.')?.lead, '1972');
  assert.equal(unsupportedYear(YEAR, 'In 1977 he launched the Y\'s label.', '1977'), true);
  const again = nextHop(YEAR, corpus, { hosts: ['en.wikipedia.org'], asked: [next ?? ''] });
  assert.match(again ?? '', /Yohji Yamamoto sold/i);
});

test('the newest season with a score wins', () => {
  const corpus = 'Season 1 Tomatometer 84%. Season 2 Tomatometer 85%. Season 3 has not premiered.';
  assert.equal(factAnswer(SCORE, corpus)?.lead, '85%');
  const missing = nextHop(SCORE, 'The show has 2 seasons and no critic score is printed.', {});
  assert.match(missing ?? '', /season 2 rotten tomatoes/i);
  const ahead = nextHop(SCORE, 'Season 1 Tomatometer 84%.', {});
  assert.match(ahead ?? '', /season 2 rotten tomatoes/i);
  assert.equal(nextHop(SCORE, 'Season 1 Tomatometer 84%. Season 2 Tomatometer 85%.', { asked: [ahead ?? ''] }), undefined);
});

test('a mapped distance leads with the quotient, not either length', () => {
  const corpus = 'The Great North Run is 13.1 miles. York Medieval Walls stretch 2.11 miles around the city.';
  assert.equal(factAnswer(WALLS, corpus)?.lead, '6.2');
  const hops = hopQueries(WALLS);
  assert.match(hops.join(' | '), /Great North Run distance/);
  assert.match(hops.join(' | '), /York's Medieval Walls length/);
  const sameLength = 'York city walls are 2.11 miles (3.40 kilometres) in the north of England. The Great North Run covers 13.1 miles.';
  assert.equal(factAnswer(WALLS, sameLength)?.lead, '6.2');
});

test('a ratio card leads with the quotient of the lengths it already shows', () => {
  const card = 'York walls length 2.11 mi. Great North Run distance 13.1 mi. York walls circuit 3.9';
  const fact = factAnswer(WALLS, card);
  assert.equal(fact?.lead, '6.2');
  const kv: CardNode = {
    type: 'keyvalue',
    items: [
      { label: 'York walls length', value: '2.11 mi' },
      { label: 'Great North Run distance', value: '13.1 mi' },
      { label: 'York walls circuit', value: '3.9' },
    ],
  };
  const next = placeFactLead([kv], fact!);
  const text = JSON.stringify(next);
  assert.match(text, /6\.2/);
  assert.match(text, /2\.11/);
  assert.match(text, /13\.1/);
  assert.doesNotMatch(text, /3\.9/);
  const cited: CardNode = {
    type: 'keyvalue',
    items: [
      { label: 'York walls circuit', value: '3.4 km (2 miles) [2]' },
      { label: 'Race distance', value: '13.1 miles [6]' },
    ],
  };
  const citedFact = factAnswer(WALLS, "York's medieval walls are 3.4 km (2.11 miles). The Great North Run is a 13.1 mile route.");
  assert.equal(citedFact?.lead, '6.2');
  const led = placeFactLead([cited], citedFact!);
  assert.equal(led?.[0]?.type, 'hero');
  assert.equal(led?.[0] && led[0].type === 'hero' ? led[0].value : '', '6.2');
  assert.match(JSON.stringify(led?.[1]), /\[6\]/);
  assert.doesNotMatch(JSON.stringify(led), /\[6\.2\]/);
});

test('a year offset searches the derived date once the anchor date is known', () => {
  assert.match(hopQueries(PARK).join(' '), /Walt Disney World opening date/);
  const next = nextHop(PARK, 'Walt Disney World opened on October 1, 1971.', {});
  assert.match(next ?? '', /October 1, 2021/);
  assert.match(next ?? '', /Walt Disney World/);
});

test('a birth year inside a longer question becomes the next search', () => {
  assert.match(hopQueries(CUP).join(' '), /Connor McDavid birth year/);
  const next = nextHop(CUP, 'Connor McDavid was born on January 13, 1997.', {});
  assert.match(next ?? '', /1997/);
  assert.match(next ?? '', /captain/i);
});

test('a century question searches the name the first pages introduced', () => {
  const next = nextHop(CENTURY, 'The Dutch equivalent is Prinsjesdag, held on the third Tuesday of September.', {});
  assert.match(next ?? '', /Prinsjesdag current name chosen/);
  assert.equal(factAnswer(CENTURY, 'The name Prinsjesdag was chosen in 1814.')?.lead, 'the 19th century');
  const both = 'Prinsjesdag originally was a birthday in the 18th century. The current name was chosen in the 19th century.';
  assert.equal(factAnswer(CENTURY, both)?.lead, 'the 19th century');
  assert.equal(factAnswer(CENTURY, 'The tradition dates to the 18th century.'), undefined);
  const again = nextHop(CENTURY, 'Prinsjesdag harks back to the 18th century.', {});
  assert.match(again ?? '', /Prinsjesdag current name chosen/);
  const card: CardNode[] = [
    { type: 'hero', value: 'the 18th century', label: 'Century' },
    { type: 'text', text: 'The current name was chosen in the th century. The name dates back to the 18th century.' },
    { type: 'keyvalue', items: [{ label: 'Name chosen', value: 'Th century' }] },
  ];
  const led = placeFactLead(card, { lead: 'the 19th century', label: 'Century', note: '' });
  assert.equal(led?.[0] && led[0].type === 'hero' ? led[0].value : '', 'the 19th century');
  const aligned = alignFactProse(led ?? card, { lead: 'the 19th century', label: 'Century', note: '' });
  const body = aligned?.map((node) => JSON.stringify(node)).join('\n') ?? '';
  assert.match(body, /chosen in the 19th century/);
  assert.match(body, /dates back to the 18th century/);
  assert.match(body, /Name chosen/);
  assert.match(body, /the 19th century/);
  assert.doesNotMatch(body, /\bth century/i);
});

test('shopping, video, paper, lakes, a person, and an agency count are not fact hops', () => {
  for (const query of [
    'best hdmi cable for a tv',
    'how to tie a tie video tutorial',
    'recent arXiv preprints on retrieval augmented generation',
    'Find recent academic publications on climate change and extreme weather, with DOIs or PMC IDs',
    'How many lakes are in Minnesota?',
    'Who is Michael Jordan?',
    'How many cyclospora cases did the FDA report?',
  ]) {
    assert.deepEqual(hopQueries(query), [], query);
    assert.equal(nextHop(query, 'Some ordinary page about the topic with 11,842 lakes.'), undefined, query);
    assert.equal(factAnswer(query, '11,842 lakes. doi.org. fda.gov.'), undefined, query);
  }
});

test('a wrong age on the card is replaced by the age the dates imply', () => {
  const hero: CardNode = { type: 'hero', value: '22', label: 'Age at the wedding' };
  const next = patchFactLead(hero, '52');
  assert.equal(next && next.type === 'hero' ? next.value : '', '52');
  assert.equal(patchFactLead({ type: 'hero', value: '52', label: 'Age' }, '52'), undefined);
});

test('a card that states the dates and not the age gains an age hero', () => {
  const kv: CardNode = {
    type: 'keyvalue',
    items: [
      { label: 'Born', value: 'May 12, 1966' },
      { label: 'Married', value: 'September 13, 2018' },
    ],
  };
  const next = placeFactLead([kv], { lead: '52', label: 'Age', note: '' });
  assert.equal(next?.[0]?.type, 'hero');
  assert.equal(next?.[0] && next[0].type === 'hero' ? next[0].value : '', '52');
  assert.equal(next?.[1], kv);
  assert.equal(placeFactLead([{ type: 'hero', value: '52', label: 'Age' }], { lead: '52', label: 'Age', note: '' }), undefined);
});

test('a derived age stays on the card when the pages state the two dates', () => {
  const sources: ClaimSource[] = [
    { n: 1, text: 'Stephen Baldwin was born May 12, 1966.' },
    { n: 2, text: 'Hailey Baldwin and Justin Bieber married on September 13, 2018.' },
  ];
  const hero: CardNode = { type: 'hero', value: '52', label: 'Age', caption: 'Born 1966 [1]' };
  const kept = bindClaims(hero, sources, AGE);
  assert.equal(kept.type === 'hero' ? kept.value : '', '52');
});
