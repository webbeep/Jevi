import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculationAnswer, cardPriceAndTax, figureValue, isCalculationAsk, leadTaxedTotal, rateOnAmount, readFigures, splitCount, splitShare, subjectTitle } from '../server/calculate.ts';
import { extractStats } from '../server/extract.ts';
import type { AnswerCard, CardNode } from '../shared/card.ts';

const headline = '10/9 The Lead: Three Darkhorse First-Time All-Stars for the 2026-27 Season';

test('a calculation follow-up is arithmetic on the card, and a how-to is not', () => {
  assert.equal(isCalculationAsk('Can you just do the math'), true);
  assert.equal(isCalculationAsk('do the math'), true);
  assert.equal(isCalculationAsk('Add the points, rebounds, and assists'), true);
  assert.equal(isCalculationAsk("What's the total of those"), true);
  assert.equal(isCalculationAsk('Add them up'), true);
  assert.equal(isCalculationAsk('How many wolves live in Minnesota'), false);
  assert.equal(isCalculationAsk('Draft the unblock email'), false);
  assert.equal(isCalculationAsk('How to calculate a mortgage payment'), false);
  assert.equal(isCalculationAsk('What is the formula for the area of a circle'), false);
});

test('a clock stays whole, and weight is not labeled as a points line', () => {
  const clock = readFigures('1 shots over 15:07 minutes of action.');
  assert.equal(clock.length, 1);
  assert.equal(clock[0]!.display, '15:07');
  assert.equal(figureValue(clock[0]!), '15:07');
  assert.equal(clock[0]!.label, 'Minutes');
  assert.notEqual(figureValue(clock[0]!), '07 minutes');

  const mixed = readFigures('PPG 19.7 RPG 2.8 APG 5.1 and weighs 88kg.');
  assert.equal(mixed.find((f) => f.label === 'PPG')?.amount, 19.7);
  const weight = mixed.find((f) => f.amount === 88);
  assert.equal(weight?.label, 'Weight');
  assert.equal(weight?.unit, 'kg');
  assert.notEqual(weight?.label, 'PPG');

  const minutes = readFigures('He played 339 minutes in the exhibition.');
  assert.equal(minutes.length, 1);
  assert.equal(minutes[0]!.amount, 339);
  assert.equal(minutes[0]!.label, 'Minutes');
  assert.equal(figureValue(minutes[0]!), '339 minutes');
});

test('extractive stats keep each measure with its own label', () => {
  const stats = extractStats([{
    id: 's0',
    text: 'PPG 19.7 RPG 2.8 APG 5.1 and weighs 88kg. 1 shots over 15:07 minutes of action.',
    url: 'https://stats.example/box',
    domain: 'stats.example',
  }], 6);
  assert.ok(stats.every((s) => s.label.length < 40));
  assert.ok(stats.some((s) => s.label === 'PPG' && s.value === '19.7'));
  assert.ok(stats.some((s) => s.label === 'Weight' && s.value.includes('88')));
  assert.equal(stats.some((s) => s.value === '07' || s.value === '07 minutes'), false);
  assert.ok(stats.some((s) => s.value === '15:07'));
  assert.equal(stats.some((s) => s.label.includes('PPG') && s.value.includes('88')), false);
});

test('adding named stats does not pull an unrelated headline or a different measure', () => {
  const card: AnswerCard = {
    title: 'Player Stats',
    body: [
      { type: 'stat', label: 'PPG', value: '19.7' },
      { type: 'stat', label: 'RPG', value: '2.8' },
      { type: 'stat', label: 'APG', value: '5.1' },
      { type: 'stat', label: 'Weight', value: '88', unit: 'kg' },
    ],
  };
  const answer = calculationAnswer({
    question: 'Add the points, rebounds, and assists',
    original: 'player stats',
    priorTitle: 'Player Stats',
    card,
    search: {
      results: [{ title: headline, snippet: 'He weighs 88kg and played 339 minutes. 1 shots over 15:07 minutes of action.' }],
    },
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.title, 'Player Stats');
  assert.equal(answer.subtitle, 'Total');
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('88'), false);
  assert.equal(body.includes('15:07'), false);
  assert.match(body, /27\.6/);
  assert.match(body, /19\.7/);
  assert.match(body, /2\.8/);
  assert.match(body, /5\.1/);
});

test('a non-sports "do the math" adds the same-unit figures and keeps the subject capitalization', () => {
  assert.equal(subjectTitle('ada lovelace notes', 'Ada Lovelace'), 'Ada Lovelace Notes');
  assert.equal(subjectTitle('monthly rent and utilities', 'Monthly Rent and Utilities'), 'Monthly Rent and Utilities');
  const card: AnswerCard = {
    title: 'Monthly Rent and Utilities',
    body: [
      { type: 'stat', label: 'Rent', value: '$1,800' },
      { type: 'stat', label: 'Utilities', value: '$240' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'monthly rent and utilities',
    priorTitle: card.title,
    card,
    search: { results: [{ title: headline, snippet: 'Unrelated 88kg note.' }] },
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.title, 'Monthly Rent and Utilities');
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('88'), false);
  assert.match(body, /\$1,800/);
  assert.match(body, /\$240/);
  assert.match(body, /\$2,040/);
});

test('two different measures are not added into one number', () => {
  const card: AnswerCard = {
    title: 'Box Score',
    body: [
      { type: 'stat', label: 'PPG', value: '19.7' },
      { type: 'stat', label: 'Weight', value: '88', unit: 'kg' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'box score',
    priorTitle: 'Box Score',
    card,
    search: { results: [{ title: headline, snippet: 'A season preview.' }] },
  });
  const body = JSON.stringify(answer);
  assert.equal(body.includes('107.7'), false);
  assert.equal(body.includes('Darkhorse'), false);
  assert.match(body, /different measures/);
  assert.match(body, /19\.7/);
  assert.match(body, /88 kg/);
});

test('a second line of the same measure is not added again', () => {
  const card: AnswerCard = {
    title: 'Player Stats',
    body: [
      { type: 'stat', label: 'PTS', value: '21.8' },
      { type: 'stat', label: 'REB', value: '10' },
      { type: 'stat', label: 'AST', value: '5.3' },
      { type: 'stat', label: 'Career PTS', value: '23.5' },
      { type: 'stat', label: 'Career AST', value: '3.9' },
    ],
  };
  const answer = calculationAnswer({
    question: 'Add the points, rebounds, and assists',
    original: 'player stats',
    priorTitle: 'Player Stats',
    card,
  });
  const body = JSON.stringify(answer);
  assert.match(body, /37\.1/);
  assert.equal(body.includes('23.5'), false);
  assert.equal(body.includes('3.9'), false);
});

test('a nutrition table adds the calorie column, not every gram on the row', () => {
  const card: AnswerCard = {
    title: 'Banana vs Apple Calories',
    body: [
      { type: 'tile', label: 'Medium banana', value: '105' },
      { type: 'tile', label: 'Medium apple', value: '95' },
      {
        type: 'table',
        columns: ['', 'Medium banana', 'Medium apple'],
        rows: [
          ['Calories', '105', '95'],
          ['Carbs', '27 g', '25 g'],
          ['Sugar', '14 g', '19 g'],
        ],
      },
      { type: 'text', text: `${headline} A medium banana has about 5 calories and a medium apple about 95.` },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'calories in a medium banana and a medium apple',
    priorTitle: card.title,
    card,
  });
  const body = JSON.stringify(answer);
  assert.equal(answer.subtitle, 'Total');
  assert.match(body, /105/);
  assert.match(body, /95/);
  assert.match(body, /= 200/);
  assert.equal(body.includes('143'), false);
  assert.equal(body.includes('27'), false);
  assert.equal(body.includes('Darkhorse'), false);
  assert.equal(body.includes('about 5'), false);
});

test('a total and a count become a rate when the ask is just to calculate', () => {
  const card: AnswerCard = {
    title: 'Season Totals',
    body: [
      { type: 'stat', label: 'Points', value: '620' },
      { type: 'stat', label: 'Games', value: '36' },
    ],
  };
  const answer = calculationAnswer({
    question: 'do the math',
    original: 'season totals',
    priorTitle: 'Season Totals',
    card,
  });
  assert.equal(answer.subtitle, 'Rate');
  assert.match(JSON.stringify(answer), /17\.22/);
  assert.match(JSON.stringify(answer), /620/);
  assert.match(JSON.stringify(answer), /36/);
});

test('a follow-up that applies a rate already on the card answers at once', () => {
  const started = Date.now();
  const card: AnswerCard = {
    title: 'City shopping',
    body: [{ type: 'text', text: 'State 5%. City 3%. Combined 8%.' }],
  };
  const answer = rateOnAmount({
    question: 'So on $50, about how many dollars is the tax?',
    original: 'a jacket in the city',
    priorTitle: 'City shopping',
    card,
  });
  assert.ok(answer);
  assert.match(answer?.title ?? '', /\$4\.00/);
  assert.match(JSON.stringify(answer), /\$50 × 8%/);
  assert.ok(Date.now() - started < 1000);
});

// The NYC card from the benchmark chain (FU-01.T2): a price, a rounded rate and the precise rate, no total.
const NYC_CARD: AnswerCard = {
  title: 'Switch 2 Price With NYC Tax',
  subtitle: 'Official US price plus New York City sales tax',
  body: [
    { type: 'hero', value: '$499.99', unit: 'USD', label: 'Switch 2 US price after increase', caption: 'Up from $449.99; NYC sales tax added at checkout [7]' },
    { type: 'grid', cols: 3, children: [
      { type: 'tile', label: 'Switch 2 price', value: '$499.99' },
      { type: 'tile', label: 'NY sales tax', value: 'Almost 9%' },
      { type: 'tile', label: 'Nintendo fee', value: '1.5% of retail, max $15' },
    ] },
    { type: 'keyvalue', items: [{ label: 'Nintendo sales tax', value: 'Set by local tax laws' }, { label: 'NYC sales tax rate', value: 'Manhattan 8.875%' }] },
  ],
};

test('a card reads its price and its most precise tax rate', () => {
  assert.deepEqual(cardPriceAndTax(NYC_CARD.body), { price: 499.99, rate: 8.875, total: undefined });
});

test('splitting the bill divides the taxed total worked from the precise rate', () => {
  assert.equal(splitCount('If my brother and I split it, how much does each of us pay?'), 2);
  assert.equal(splitCount('split it three ways'), 3);
  assert.equal(splitCount('my sister and my brother and I'), 3);
  const split = splitShare({ question: 'If my brother and I split it, how much does each of us pay?', card: NYC_CARD });
  assert.ok(split);
  assert.equal((split.nodes[0] as Extract<CardNode, { type: 'hero' }>).value, '$272.18 each');
  assert.match(JSON.stringify(split.nodes), /\$544\.36/);
  assert.equal(splitShare({ question: 'How long is the battery life?', card: NYC_CARD }), undefined);
});

test('a with-tax ask leads with the taxed total', () => {
  const next = leadTaxedTotal('What would I pay with sales tax in New York City?', NYC_CARD.body);
  const hero = next?.[0] as Extract<CardNode, { type: 'hero' }>;
  assert.equal(hero.value, '$544.36');
  assert.match(hero.caption ?? '', /\$499\.99 \+ 8\.875% tax \(\$44\.37\)/);
  assert.equal(next?.[1], NYC_CARD.body[1]);
  assert.equal(leadTaxedTotal('How much is a Switch 2?', NYC_CARD.body), undefined);
});

test('a combined rate labeled "rate" is the tax rate, and the split uses the taxed total', async () => {
  const { splitShare, leadTaxedTotal } = await import('../server/calculate.ts');
  const card = { title: 'Switch 2 in NYC With Tax', body: [
    { type: 'keyvalue' as const, items: [{ label: 'Base price (MSRP)', value: '$499.99 [12]' }, { label: 'Combined NYC rate', value: '8.875% [7]' }, { label: 'NYC parts', value: '4% state + 4.5% city + 0.375% MCTD' }] },
  ] };
  const split = splitShare({ question: 'If my brother and I split it, how much does each of us pay?', card });
  assert.equal(split?.nodes[0]?.type === 'hero' ? split.nodes[0].value : '', '$272.18 each');
  const led = leadTaxedTotal('What would I pay with sales tax in New York City?', card.body);
  assert.equal(led?.[0]?.type === 'stack' && led[0].children[0]?.type === 'hero' ? led[0].children[0].value : '', '$544.36');
});

test('a rate stated in a sentence still gives the taxed total', async () => {
  const { leadTaxedTotal, splitShare } = await import('../server/calculate.ts');
  const body = [
    { type: 'keyvalue' as const, items: [{ label: 'Console MSRP', value: '$499.99 [14]' }] },
    { type: 'section' as const, title: 'Good to know', children: [{ type: 'text' as const, text: 'The statewide rate alone is 4%; local rates push the total as high as 8.875%. [7] A sale shipped to New York City requires 8.875% [10].' }] },
  ];
  const led = leadTaxedTotal('What would I pay with sales tax in New York City?', body);
  assert.equal(led?.[0]?.type === 'stack' && led[0].children[0]?.type === 'hero' ? led[0].children[0].value : '', '$544.36');
  const split = splitShare({ question: 'If my brother and I split it, how much does each of us pay?', card: { title: 'Switch 2', body } });
  assert.equal(split?.nodes[0]?.type === 'hero' ? split.nodes[0].value : '', '$272.18 each');
});

test('the test deployment counts searches in its own daily bucket', async () => {
  const { capBucket, testHost, capFor } = await import('../server/providerCap.ts');
  assert.equal(testHost('https://jevi.pages.dev/api/stream'), true);
  assert.equal(testHost('https://bb006651.jevi.pages.dev/api/stream'), true);
  assert.equal(testHost('https://zo.fyi/api/stream'), false);
  assert.equal(testHost('https://notjevi.pages.dev/'), false);
  assert.equal(capBucket({ test: true }), 'test');
  assert.equal(capBucket({}), 'prod');
  assert.equal(capFor({} as never, 'serper', 'test'), 2000);
  assert.equal(capFor({} as never, 'exa', 'test'), 0);
});

test('a combined rate kept as a stat with its unit apart is the rate, not a surcharge in the text', async () => {
  const { cardPriceAndTax } = await import('../server/calculate.ts');
  const nodes: CardNode[] = [
    { type: 'hero', value: '$499.99', label: 'List price' },
    { type: 'stat', label: 'NYC combined rate', value: '8.875', unit: '%' },
    { type: 'text', text: 'The rate includes a 0.375% MCTD surcharge.' },
  ];
  assert.deepEqual(cardPriceAndTax(nodes), { price: 499.99, rate: 8.875, total: undefined });
});

test('without a combined rate the card\'s rate parts add up, and one part is never the rate', async () => {
  const { cardPriceAndTax } = await import('../server/calculate.ts');
  const parts: CardNode[] = [
    { type: 'hero', value: '$499.99', label: 'List price' },
    { type: 'keyvalue', items: [{ label: 'NY State sales tax', value: '4%' }, { label: 'NYC local sales tax', value: '4.5%' }, { label: 'MCTD surcharge', value: '0.375%' }, { label: 'Nintendo recycling fee', value: '1.5%' }] },
  ];
  assert.equal(cardPriceAndTax(parts).rate, 8.875);
  const single: CardNode[] = [{ type: 'hero', value: '$100', label: 'Price' }, { type: 'stat', label: 'Sales tax rate', value: '6.25%' }];
  assert.equal(cardPriceAndTax(single).rate, 6.25);
  const onePart: CardNode[] = [{ type: 'hero', value: '$100', label: 'Price' }, { type: 'stat', label: 'MCTD surcharge', value: '0.375%' }];
  assert.equal(cardPriceAndTax(onePart).rate, undefined);
});

test('a lone state rate is the rate', async () => {
  const { cardPriceAndTax } = await import('../server/calculate.ts');
  assert.equal(cardPriceAndTax([{ type: 'hero', value: '$100', label: 'Price' }, { type: 'stat', label: 'Texas state sales tax', value: '6.25%' }]).rate, 6.25);
});
