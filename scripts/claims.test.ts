import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindClaims, budgetAmounts, claimSources, groundMembers, officialCharge, oneNamedCharge, presentNamedCharges, priceFor, retargetCites, salesTax, shoppingAsk, type ClaimSource } from '../server/claims.ts';
import { Grounding, groundNodes } from '../server/ground.ts';
import { sanitizeNodes } from '../server/sanitize.ts';
import { finishQuality } from '../server/sourceQuality.ts';
import type { CardNode } from '../shared/card.ts';

const sources: ClaimSource[] = [
  { n: 1, text: 'Minnesota wolf survey 2020. The estimate that year was 2,696 wolves.' },
  { n: 2, text: 'Wolf population plunges around Voyageurs National Park. Local packs fell 19 percent.' },
  { n: 3, text: 'Minnesota DNR 2024-25 survey. The population point estimate is 2,294 wolves.' },
];

test('a number moves to the page that states it', () => {
  const text = retargetCites('Minnesota has about 2,294 wolves, DNR 2025 [1].', sources);
  assert.match(text, /\[3\]/);
  assert.doesNotMatch(text, /\[1\]/);
  assert.doesNotMatch(text, /2025/);
  assert.match(text, /2,294/);
});

test('a tile source is the page that contains its number', () => {
  const tile: CardNode = { type: 'tile', label: 'Latest estimate', value: '2,294', sub: 'DNR 2025', source: 1 };
  const next = bindClaims(tile, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'tile' ? next.source : 0, 3);
  assert.equal(next.type === 'tile' ? next.sub : '', 'DNR');
});

test('a grounded year still drops the clauses whose year is already missing', () => {
  const page: ClaimSource[] = [{ n: 3, text: 'The band released an EP in 2023.' }];
  const text = retargetCites('The band formed in, debut EP in, first album in, then EPs in and 2023. [3]', page);
  assert.doesNotMatch(text, /\bin,/);
  assert.doesNotMatch(text, /\bin and\b/);
  assert.match(text, /2023/);
});

test('a number no page states is dropped instead of cited', () => {
  const text = retargetCites('Minnesota has about 2,300 wolves [1].', sources);
  assert.doesNotMatch(text, /2,300/);
  assert.doesNotMatch(text, /\[1\]/);
  assert.doesNotMatch(text, /about wolves/i);
  const tile: CardNode = { type: 'tile', label: 'Latest', value: '~2,300', sub: 'DNR 2025', source: 1 };
  const next = bindClaims(tile, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'tile' ? next.value : 'x', undefined);
});

test('a missing year drops the clause instead of leaving a hole', () => {
  const pages: ClaimSource[] = [{ n: 1, text: 'He later started a research lab. No founding year is given.' }];
  const text = retargetCites('In 2021 he founded Eureka Labs [1].', pages);
  assert.doesNotMatch(text, /In he /i);
  assert.doesNotMatch(text, /2021/);
  assert.match(text, /founded Eureka Labs/i);
  const placeholder: CardNode = { type: 'text', text: 'In [year] he founded Eureka Labs.' };
  const next = bindClaims(placeholder, pages, 'When did he found Eureka Labs?');
  const body = next.type === 'text' ? next.text : '';
  assert.doesNotMatch(body, /\[year\]/i);
  assert.doesNotMatch(body, /In he /i);
});

test('shopping picks take a price from the page that names them', () => {
  assert.equal(shoppingAsk('Best laptop under $800'), true);
  assert.equal(shoppingAsk('how do mRNA vaccines work'), false);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The MacBook Neo starts at $699.' },
    { n: 2, text: 'Dell XPS 13 is $800. HP OmniBook 5 tested at $749.' },
  ];
  assert.deepEqual(priceFor('HP OmniBook 5', catalog), { price: '$749', n: 2 });
  assert.deepEqual(priceFor('MacBook Neo (A18 Pro)', catalog), { price: '$699', n: 1 });
  const list: CardNode = {
    type: 'list',
    style: 'number',
    items: [
      { text: 'MacBook Neo', meta: '$699', source: 1 },
      { text: 'Dell XPS 13' },
      { text: 'HP OmniBook 5' },
    ],
  };
  const next = bindClaims(list, catalog, 'Best laptop under $800');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items[1]?.meta, '$800');
  assert.equal(items[2]?.meta, '$749');
  assert.equal(items[0]?.meta, '$699');
});

test('a price above the stated budget is not shown on a pick', () => {
  const catalog: ClaimSource[] = [
    { n: 1, text: 'Best headphones under $200. The Edifier ES850NB supports LDAC.' },
    { n: 2, text: 'Sony WH-CH720N is $88. Edifier ES850NB is $119.99.' },
  ];
  const list: CardNode = {
    type: 'list',
    style: 'check',
    items: [
      { text: 'Sony WH-CH720N', meta: '$88' },
      { text: 'Codec support for hi-res: LDAC on the Edifier ES850NB', meta: '$200' },
    ],
  };
  const next = bindClaims(list, catalog, 'Wireless Noise Cancelling Headphones Under $150');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items.some((item) => /\$200/.test(`${item.meta ?? ''} ${item.text}`)), false);
  assert.equal(items.some((item) => item.meta === '$88'), true);
  const chips: CardNode = {
    type: 'choices',
    label: 'Budget',
    options: [
      { label: 'Under $100', prompt: 'under $100', selected: false },
      { label: 'Under $150', prompt: 'under $150', selected: true },
      { label: 'Under $200', prompt: 'under $200', selected: false },
    ],
  };
  const kept = bindClaims(chips, catalog, 'Wireless Noise Cancelling Headphones Under $150');
  const labels = kept.type === 'choices' ? kept.options.map((option) => option.label) : [];
  assert.deepEqual(labels, ['Under $100', 'Under $150']);
  const dangling: CardNode = { type: 'list', items: [{ text: 'JBL Live 780NC', meta: 'Best under $200' }] };
  const cleared = bindClaims(dangling, catalog, 'Wireless Noise Cancelling Headphones Under $150');
  assert.equal(cleared.type === 'list' ? cleared.items[0]?.meta : 'kept', undefined);
  const hero: CardNode = {
    type: 'hero',
    value: 'JBL Live 778NC',
    label: 'Top pick under $150',
    caption: "Best noise cancelling headphones under $200 we've tested",
  };
  const headed = bindClaims(hero, catalog, 'Wireless Noise Cancelling Headphones Under $150');
  assert.match(headed.type === 'hero' ? headed.caption ?? '' : '', /Best noise cancelling headphones we've tested/);
  assert.equal(headed.type === 'hero' ? headed.label : '', 'Top pick under $150');
  assert.doesNotMatch(headed.type === 'hero' ? `${headed.caption} ${headed.value}` : '', /\$200/);
});

test('a budget ceiling is not the product price', () => {
  assert.deepEqual(budgetAmounts('Best laptop under $800'), [800]);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'Dell XPS 13 is $999.99. Other thin laptops stay under $800.' },
  ];
  const list: CardNode = { type: 'list', style: 'number', items: [{ text: 'Dell XPS 13', meta: 'Under $800' }] };
  const next = bindClaims(list, catalog, 'Best laptop under $800');
  const meta = next.type === 'list' ? next.items[0]?.meta ?? '' : '';
  assert.notEqual(meta, '$999.99');
  assert.doesNotMatch(meta, /999/);
});

test('a city sales tax uses the combined rate once the item clears the exemption', () => {
  const pages: ClaimSource[] = [
    { n: 1, text: 'New York State sales tax is 4%.' },
    { n: 2, text: 'The combined sales tax rate in New York City is 8.875%. Clothing and footwear priced under $110 are exempt from the 4% state tax. Items $110 and up pay the full combined rate.' },
  ];
  assert.deepEqual(salesTax('sales tax on $150 sneakers in New York City', pages), { rate: 8.875, n: 2 });
  const text: CardNode = { type: 'text', text: 'Sales tax is 4% ($6).' };
  const next = bindClaims(text, pages, 'What is the sales tax on $150 sneakers in New York City?');
  const body = next.type === 'text' ? next.text : '';
  assert.match(body, /8\.875%/);
  assert.match(body, /\$13\.31/);
  assert.match(body, /\[2\]/);
  assert.doesNotMatch(body, /4%/);
});

test('a round rate loses to the combined rate the official page states', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'tips.example', text: 'Harbor City sales tax\nHarbor City sales tax is 7%.' },
    { n: 2, domain: 'www.harborcity.gov', text: 'Harbor City sales tax\nThe combined rate is 7.375%.' },
  ];
  assert.deepEqual(salesTax('sales tax in Harbor City', pages), { rate: 7.375, n: 2 });
  const precise: ClaimSource[] = [
    { n: 1, domain: 'tips.example', text: 'Harbor City sales tax is 7%.' },
    { n: 2, domain: 'tax.harborcity.gov', text: 'Harbor City sales tax is 7.375%.' },
  ];
  assert.deepEqual(salesTax('sales tax in Harbor City', precise), { rate: 7.375, n: 2 });
  const next = bindClaims({ type: 'text', text: 'Sales tax in Harbor City is 7%.' }, pages, 'sales tax in Harbor City');
  assert.match(next.type === 'text' ? next.text : '', /7\.375%/);
  assert.doesNotMatch(next.type === 'text' ? next.text : '', /\b7%/);
});

test('a combined city rate leads when the official page only states the state piece', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nHarbor State imposes a 6.25 percent state sales and use tax.' },
    { n: 2, domain: 'www.harborstate.gov', text: 'City tax\nHarbor City total includes the state\'s sales and use tax rate of 6.25%.' },
    { n: 3, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe minimum combined sales tax rate for Harbor City is 8.25%.' },
  ];
  assert.deepEqual(salesTax('Harbor City combined sales tax', pages), { rate: 8.25, n: 3 });
});

test('an escaped decimal in a fetched page is still the combined rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor City sales tax\nLocal jurisdictions can impose up to 2 percent for a maximum combined rate of 8\\.25 percent.' },
  ];
  assert.deepEqual(salesTax('Harbor City combined sales tax', pages), { rate: 8.25, n: 1 });
});

test('the state written after the city does not hide the combined rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nHarbor State imposes a 6.25 percent state sales and use tax.' },
    { n: 2, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe minimum combined sales tax rate for Harbor City, Eastland is 8.25%. The Harbor City sales tax rate is 1.00%.' },
  ];
  assert.deepEqual(salesTax('Harbor City combined sales tax', pages), { rate: 8.25, n: 2 });
});

test('an official combined rate still beats a commercial one when the question asks for combined', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe combined rate is 9%.' },
    { n: 2, domain: 'www.harborcity.gov', text: 'Harbor City sales tax\nThe combined sales tax rate in Harbor City is 8.25%.' },
  ];
  assert.deepEqual(salesTax('Harbor City combined sales tax', pages), { rate: 8.25, n: 2 });
});

test('an official snippet beats a commercial combined rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe combined rate is 7.5%.' },
    { n: 2, domain: 'www.harborcity.gov', text: 'Harbor City tax\nRates are listed in the table.', stated: 'Harbor City total rate 7.125%' },
  ];
  assert.deepEqual(salesTax('sales tax in Harbor City', pages), { rate: 7.125, n: 2 });
  const next = bindClaims({ type: 'text', text: 'The combined rate is 7.5%.' }, pages, 'sales tax in Harbor City');
  assert.match(next.type === 'text' ? next.text : '', /7\.125%/);
  assert.doesNotMatch(next.type === 'text' ? next.text : '', /7\.5%/);
});

test('the lead rate is the official page, and a sum that misses it leaves', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe combined rate is 9.5%.' },
    { n: 2, domain: 'www.harborcity.gov', text: 'Harbor City sales tax\nThe general merchandise rate is 6.25%.' },
  ];
  assert.deepEqual(salesTax('sales tax in Harbor City', pages), { rate: 6.25, n: 2 });
  const next = bindClaims({
    type: 'hero',
    value: '9.5%',
    label: 'Combined rate',
    caption: '6.25% state + 1.25% city + 1.25% county',
  }, pages, 'sales tax in Harbor City');
  assert.equal(next.type === 'hero' ? next.value : '', '6.25%');
  assert.equal(next.type === 'hero' ? next.caption : 'kept', '');
});

test('a fee card does not keep a second amount the official page does not state', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'permits.harbor.gov', text: 'Renew a harbor permit by mail\nThe renewal fee for a harbor permit book is $42.' },
  ];
  const next = bindClaims({ type: 'stack', gap: 'md', children: [
    { type: 'hero', value: '$64', label: 'Renewal fee' },
    { type: 'stat', label: 'Book fee', value: '$42' },
  ] }, pages, 'What is the renewal fee for a harbor permit book by mail?');
  const blob = JSON.stringify(next);
  assert.match(blob, /\$42/);
  assert.doesNotMatch(blob, /\$64/);
});

test('a component rate stays and the combined line uses the official rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.rates.example', text: 'Harbor City sales tax\nThe combined rate is 7.5%.' },
    { n: 2, domain: 'www.harborcity.gov', text: 'Harbor City sales tax\nThe state rate is 6.25%. The combined rate is 7.125%.' },
  ];
  const next = bindClaims({ type: 'text', text: 'The state rate is 6.25%. The combined rate is 7.5%.' }, pages, 'sales tax in Harbor City');
  const body = next.type === 'text' ? next.text : '';
  assert.match(body, /7\.125%/);
  assert.doesNotMatch(body, /6\.25%/);
  assert.doesNotMatch(body, /7\.5%/);
});

test('a list percent agrees with the official rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nThe general merchandise rate is 6.25%.' },
  ];
  const next = bindClaims({ type: 'list', items: [{ text: 'General merchandise is 2.69%.' }, { text: 'The state rate is 6.25%.' }] }, pages, 'What is the sales tax on general merchandise in Harbor State?');
  const blob = JSON.stringify(next);
  assert.match(blob, /6\.25%/);
  assert.doesNotMatch(blob, /2\.69%/);
});

test('a small share inside a breakdown is not the merchandise rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nThe general merchandise rate is 6.25%.' },
    { n: 2, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nGeneral merchandise consists of a 5.00% state rate, a 1.00% local rate and a 0.25% county rate.' },
  ];
  assert.deepEqual(salesTax('What is the sales tax on general merchandise in Harbor State?', pages), { rate: 6.25, n: 1 });
});

test('a revenue share is not the sales tax rate', () => {
  const pages: ClaimSource[] = [
    {
      n: 1,
      domain: 'www.harborstate.gov',
      text: 'Harbor State sales tax\nSales tax revenues as a percentage of total general revenues declined from almost 30% in fiscal year 1990 to less than 23%. The state sales tax rate has remained constant at 6.25%.',
    },
  ];
  assert.deepEqual(salesTax('What is the sales tax on general merchandise in Harbor State?', pages), { rate: 6.25, n: 1 });
});

test('a local increment is not the rate the official page states', () => {
  const pages: ClaimSource[] = [
    {
      n: 1,
      domain: 'www.harborstate.gov',
      text: 'Harbor State sales tax\nWhile local add-ons have grown, the state sales tax rate has remained constant at 6.25% for the past twenty years. The current state sales tax rate is 6.25%, of which the state retains 80% of the tax. A uniform state sales and use tax rate on general merchandise of 6.25 percent was established. The tax may be imposed in 0.25% increments and cannot exceed 1%. 0.25% sales tax on general merchandise in Madison County. The tax rate is 0.25%.',
    },
  ];
  assert.deepEqual(salesTax('What is the sales tax on general merchandise in Harbor State?', pages), { rate: 6.25, n: 1 });
  const next = bindClaims({
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'hero', value: '0.25%', label: 'Harbor State sales tax on general merchandise' },
      { type: 'text', text: 'Qualifying food, drugs and medical appliances are taxed at 1%.' },
      { type: 'chart', kind: 'bar', unit: '%', title: 'Compare rate', data: [{ label: 'Statewide', value: 0.04 }, { label: 'Palatine', value: 2.69 }] },
    ],
  }, pages, 'What is the sales tax on general merchandise in Harbor State?');
  const blob = JSON.stringify(next);
  assert.match(blob, /6\.25%/);
  assert.doesNotMatch(blob, /0\.25%|0\.04|2\.69|1%/);
  assert.doesNotMatch(blob, /"type":"chart"/);
});

test('a city rate does not lead when the official page states the broader rate', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nThe general merchandise rate is 6.25%.' },
    { n: 2, domain: 'www.harborstate.gov', text: 'Harbor State sales tax\nPalatine combined local rate is 2.69%.' },
  ];
  assert.deepEqual(salesTax('What is the sales tax on general merchandise in Harbor State?', pages), { rate: 6.25, n: 1 });
  const next = bindClaims({ type: 'text', text: 'General merchandise sales tax is 2.69%. The state rate is 6.25%.' }, pages, 'What is the sales tax on general merchandise in Harbor State?');
  const body = next.type === 'text' ? next.text : '';
  assert.match(body, /6\.25%/);
  assert.doesNotMatch(body, /2\.69%/);
});

test('a fee is the amount the official page states', () => {
  const pages: ClaimSource[] = [
    { n: 1, domain: 'travelblog.example', text: 'The renewal fee is $64.' },
    { n: 2, domain: 'permits.harbor.gov', text: 'Harbor permits\nThe renewal fee for a harbor permit is $42. The application fee is $18.' },
  ];
  assert.deepEqual(officialCharge('What is the renewal fee for a harbor permit?', pages), { amount: '$42', value: 42, n: 2 });
  const snippet: ClaimSource[] = [
    { n: 1, domain: 'notes.example', text: 'The renewal fee is $64. A book and card is $80.' },
    { n: 2, domain: 'permits.harbor.gov', text: 'Harbor permits\nFee schedule.', stated: 'The renewal fee for a harbor permit book is $42. A book and card renewal is $80.' },
  ];
  assert.deepEqual(officialCharge('What is the renewal fee for a harbor permit book?', snippet), { amount: '$42', value: 42, n: 2 });
  const next = bindClaims({ type: 'stat', label: 'Renewal fee', value: '$64 [1]' }, pages, 'What is the renewal fee for a harbor permit?');
  const value = next.type === 'stat' ? next.value : '';
  assert.match(value, /\$42/);
  assert.doesNotMatch(value, /\$64/);
  assert.match(value, /\[2\]/);
  const listed = bindClaims({ type: 'text', text: 'The renewal fee is $64. The application fee is $18.' }, pages, 'What is the renewal fee for a harbor permit?');
  const body = listed.type === 'text' ? listed.text : '';
  assert.match(body, /\$42/);
  assert.match(body, /\$18/);
  assert.doesNotMatch(body, /\$64/);
  const split: ClaimSource[] = [
    { n: 1, domain: 'county.example.gov', text: 'County notes\nThe renewal fee is $64.' },
    { n: 2, domain: 'permits.harbor.gov', text: 'Renew a harbor permit by mail\nThe renewal fee for a harbor permit book is $42. A book and card is $80.' },
  ];
  assert.equal(officialCharge('What is the renewal fee for a harbor permit book by mail?', split)?.amount, '$42');
  const addon: ClaimSource[] = [
    { n: 1, domain: 'notes.example', text: 'People remember the renewal fee as $64.' },
    { n: 2, domain: 'permits.harbor.gov', text: 'Renew a harbor permit book by mail\nThe renewal fee for a harbor permit book is $42.\nExpedited service, add $15.' },
  ];
  assert.equal(officialCharge('What is the renewal fee for a harbor permit book by mail?', addon)?.amount, '$42');
  const hero = bindClaims({ type: 'hero', value: '$15', label: 'Harbor permit book renewal' }, addon, 'What is the renewal fee for a harbor permit book by mail?');
  assert.match(hero.type === 'hero' ? hero.value : '', /\$42/);
  const extra = bindClaims({ type: 'text', text: 'Expedited service is $15.' }, addon, 'What is the renewal fee for a harbor permit book by mail?');
  assert.match(extra.type === 'text' ? extra.text : '', /\$15/);
  assert.doesNotMatch(extra.type === 'text' ? extra.text : '', /\$42/);
  const shifted: ClaimSource[] = [
    { n: 1, domain: 'permits.harbor.gov', text: 'Renew by mail\nYour fee depends on the document. $42 Harbor card ・ $15 Harbor book and card' },
    { n: 2, domain: 'notes.example', text: 'Harbor book renewal fees\nHarbor book: $42. Harbor card: $15. Harbor book and card: $80.' },
  ];
  assert.equal(officialCharge('What is the harbor book renewal fee?', shifted)?.amount, '$42');
  const lead = bindClaims({ type: 'stat', label: 'Renewal fee', value: '$64' }, split, 'What is the renewal fee for a harbor permit book by mail?');
  assert.match(lead.type === 'stat' ? lead.value : '', /\$42/);
  const pair = bindClaims({ type: 'text', text: 'A book and card is $80.' }, split, 'What is the renewal fee for a harbor permit book by mail?');
  assert.match(pair.type === 'text' ? pair.text : '', /\$80/);
});

test('an add-on row uses the line that names it, not the base charge', () => {
  const query = 'What is the harbor book renewal fee?';
  const pages: ClaimSource[] = [
    { n: 1, domain: 'permits.harbor.gov', text: 'Harbor permits\nThe renewal fee for a harbor permit book is $42.' },
    { n: 2, domain: 'notes.example', text: 'Harbor book renewal DS-82 is $42. Expedited service add $15. Execution fee $9. Harbor card is $11. A book and card is $80.' },
  ];
  assert.equal(officialCharge(query, pages)?.amount, '$42');
  const card = bindClaims({
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'hero', value: '$15', label: 'Harbor book renewal' },
      { type: 'tile', label: 'Book', value: '$42', sub: 'Adult renewal' },
      { type: 'tile', label: 'Expedited', value: '$42', sub: 'Extra fee' },
      { type: 'tile', label: 'Card', value: '$42', sub: 'Adult renewal' },
      { type: 'keyvalue', items: [{ label: 'Execution fee', value: '$42' }, { label: 'DS-82', value: '$15' }, { label: 'Book + card', value: '$42' }] },
      { type: 'text', text: 'Expedited service is $42. DS-82 renewal is $15.' },
    ],
  }, pages, query);
  assert.equal(card.type, 'stack');
  if (card.type !== 'stack') return;
  const hero = card.children[0];
  const book = card.children[1];
  const expedited = card.children[2];
  const cardTile = card.children[3];
  const rows = card.children[4];
  const prose = card.children[5];
  assert.equal(hero?.type === 'hero' ? hero.value : '', '$42');
  assert.equal(book?.type === 'tile' ? book.value : '', '$42');
  assert.equal(expedited?.type === 'tile' ? expedited.value : '', '$15');
  assert.equal(cardTile?.type === 'tile' ? cardTile.value : '', '$11');
  assert.match(rows?.type === 'keyvalue' ? rows.items[0]?.value ?? '' : '', /^\$9\b/);
  assert.match(rows?.type === 'keyvalue' ? rows.items[1]?.value ?? '' : '', /^\$42\b/);
  assert.match(rows?.type === 'keyvalue' ? rows.items[2]?.value ?? '' : '', /^\$80\b/);
  assert.equal(expedited?.type === 'tile' ? expedited.source : 0, 2);
  assert.match(prose?.type === 'text' ? prose.text : '', /\$15/);
  assert.match(prose?.type === 'text' ? prose.text : '', /\$42/);
  assert.doesNotMatch(prose?.type === 'text' ? prose.text : '', /Expedited service is \$42/);
  assert.doesNotMatch(prose?.type === 'text' ? prose.text : '', /DS-82 renewal is \$15/);
});

test('a second row for the same named charge is dropped', () => {
  const query = 'What is the harbor book renewal fee?';
  const nodes = oneNamedCharge(query, [
    { type: 'hero', value: '$42', label: 'Harbor book renewal' },
    {
      type: 'grid',
      cols: 2,
      children: [
        { type: 'tile', label: 'Harbor book', value: '$42', sub: 'Adult renewal' },
        { type: 'tile', label: 'Expedited add-on', value: '$15', sub: 'Optional' },
      ],
    },
    {
      type: 'grid',
      cols: 2,
      children: [
        { type: 'tile', label: 'Book + card', value: '$80' },
        { type: 'tile', label: 'Expedited', value: '$15', sub: 'Extra fee' },
        { type: 'tile', label: 'First-time book', value: '$42' },
        { type: 'tile', label: 'Minor book', value: '$27' },
      ],
    },
  ]);
  const rows = nodes.flatMap((node) => (node?.type === 'grid' ? node.children : []));
  const labels = rows.map((node) => (node.type === 'tile' ? node.label : ''));
  assert.deepEqual(labels, ['Expedited add-on', 'Book + card', 'Minor book']);
  const led = oneNamedCharge(query, [
    { type: 'hero', value: '$42', label: 'Harbor book renewal' },
    { type: 'grid', cols: 2, children: [
      { type: 'tile', label: 'First-time book', value: '$42' },
      { type: 'tile', label: 'Expedited', value: '$15' },
      { type: 'tile', label: 'Book + card', value: '$80' },
    ] },
  ]);
  const ledLabels = led.flatMap((node) => (node?.type === 'grid' ? node.children : [])).map((node) => (node.type === 'tile' ? node.label : ''));
  assert.deepEqual(ledLabels, ['Expedited', 'Book + card']);
  const generic = oneNamedCharge(query, [
    { type: 'hero', value: '$42', label: 'Renewal fee' },
    { type: 'keyvalue', items: [
      { label: 'First-time book', value: '$42' },
      { label: 'Book + card', value: '$80' },
      { label: 'Expedited', value: '$15' },
    ] },
  ]);
  const genericLabels = generic.flatMap((node) => (node?.type === 'keyvalue' ? node.items.map((item) => item.label) : []));
  assert.deepEqual(genericLabels, ['Book + card', 'Expedited']);
  const shifted: ClaimSource[] = [
    { n: 1, domain: 'permits.harbor.gov', text: 'Renew by mail\nYour fee depends on the document. $42 Harbor card ・ $18 Harbor book and card' },
    { n: 2, domain: 'notes.example', text: 'Harbor book renewal fees\nHarbor book: $42. Harbor card: $11. Harbor book and card: $80. $15—Expedited' },
  ];
  assert.equal(officialCharge(query, shifted)?.amount, '$42');
  const bound = bindClaims({
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'hero', value: '$18', label: 'Harbor book renewal' },
      { type: 'keyvalue', items: [{ label: 'Harbor card', value: '$42' }, { label: 'Book + card', value: '$18' }] },
      { type: 'grid', cols: 2, children: [
        { type: 'tile', label: 'Expedited', value: '$42', sub: 'Extra fee' },
        { type: 'tile', label: 'Expedited add-on', value: '$15' },
      ] },
    ],
  }, shifted, query);
  const once = oneNamedCharge(query, bound.type === 'stack' ? bound.children : []);
  const cardRow = once[1]?.type === 'keyvalue' ? once[1].items[0]?.value ?? '' : '';
  const pairRow = once[1]?.type === 'keyvalue' ? once[1].items[1]?.value ?? '' : '';
  const expediteRows = once[2]?.type === 'grid' ? once[2].children : [];
  assert.match(cardRow, /^\$11\b/);
  assert.match(pairRow, /^\$80\b/);
  assert.equal(expediteRows.length, 1);
  assert.match(expediteRows[0]?.type === 'tile' ? expediteRows[0].value ?? '' : '', /^\$15\b/);
  const filled = presentNamedCharges(query, [
    { type: 'stack', gap: 'md', children: [{ type: 'hero', value: '$42', label: 'Harbor book renewal' }] },
  ], shifted);
  const added = filled[0]?.type === 'stack' ? filled[0].children.flatMap((node) => (node.type === 'tile' ? [node] : [])) : [];
  assert.deepEqual(added.map((node) => node.label), ['Harbor card', 'Harbor book and card', 'Expedited']);
  assert.deepEqual(added.map((node) => node.value), ['$11', '$80', '$15']);
  const compared = oneNamedCharge('Fitbit Edge vs Mi Band 10', [
    { type: 'grid', cols: 2, children: [
      { type: 'tile', label: 'Fitbit Edge', value: '$179' },
      { type: 'tile', label: 'Mi Band 10', value: '$53' },
    ] },
  ]);
  assert.equal(compared[0]?.type === 'grid' ? compared[0].children.length : 0, 2);
});

test('an exempt price does not keep a tax dollar from another line', () => {
  const pages: ClaimSource[] = [
    { n: 1, text: 'New York State sales tax is 4%.' },
    { n: 2, text: 'The combined sales tax rate in New York City is 8.875%. Clothing and footwear priced under $110 are exempt. Items $110 and up pay the full combined rate.' },
  ];
  const query = 'If I buy a $90 pair of sneakers in a store in New York, NY, do I pay sales tax?';
  assert.equal(salesTax(query, pages), undefined);
  const next = bindClaims({ type: 'text', text: 'No. At exactly $110 or more, the full 4% ($3.60) applies. NYC combined rate 4% ($3.60).' }, pages, query);
  const body = next.type === 'text' ? next.text : '';
  assert.match(body, /^No/);
  assert.doesNotMatch(body, /\$3\.60/);
  assert.match(body, /8\.875%/);
});

test('a spaced decimal inside a quotation stays one number', () => {
  const quote = '"Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1. 5°C in the near term in considered scenarios."';
  const corpus = 'Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1.5°C in the near term in considered scenarios.';
  const kept = new Grounding(corpus).sentences(quote);
  assert.match(kept, /reaching 1\.5°C/);
  const pages: ClaimSource[] = [{ n: 1, text: corpus }];
  const cut = retargetCites(`${quote.slice(0, quote.indexOf('1.') + 2)}`, pages, 'quote the report');
  assert.match(cut, /reaching 1\.5°C/);
  assert.match(cut, /"$/);
});

test('a quotation cut at the point keeps the decimal the hero already states', () => {
  const hero: CardNode = {
    type: 'hero',
    value: '1.5°C',
    label: 'Best estimate',
    caption: '"Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1.',
  };
  const next = bindClaims(hero, [{ n: 1, text: 'The page discusses warming in general terms.' }], 'quote the report');
  const caption = next.type === 'hero' ? next.caption ?? '' : '';
  assert.match(caption, /reaching 1\.5°C"/);
});

test('a cut quotation is repaired before the quote mark is removed', () => {
  const caption = '"Continued greenhouse gas emissions will lead to increasing global warming, with the best estimate of reaching 1.';
  const [node] = sanitizeNodes([{ type: 'hero', value: '1.5°C', label: 'Best estimate', caption }], 0);
  assert.equal(node?.type, 'hero');
  if (node?.type !== 'hero') return;
  assert.match(node.caption ?? '', /reaching 1\.5°C"/);
  const corpus = 'reaching 1.5°C in the near term';
  const [grounded] = groundNodes([node], new Grounding(corpus));
  assert.match(grounded?.type === 'hero' ? grounded.caption ?? '' : '', /reaching 1\.5°C/);
  const [finished] = finishQuality('quote the official report', [grounded]);
  assert.match(finished?.type === 'hero' ? finished.caption ?? '' : '', /reaching 1\.5°C"/);
});

test('a chapter label is not rewritten into the hero number', () => {
  const caption = 'The notes for this section say see chapter 1.';
  const [node] = sanitizeNodes([{ type: 'hero', value: '1.5°C', label: 'Best estimate', caption }], 0);
  assert.equal(node?.type === 'hero' ? node.caption : '', caption);
});

test('a budgeted product ask is shopping, and a tax ask is not', () => {
  assert.equal(shoppingAsk('Help me find an HDMI switch for 3 devices to one 4K TV under $40; only real product models'), true);
  assert.equal(shoppingAsk('If I buy a $90 pair of sneakers in a store in New York, NY, do I pay sales tax?'), false);
});

test('a number inside a quotation stays when another figure is dropped', () => {
  const page = claimSources(
    [{ title: 'Report', snippet: '', domain: 'agency.example' }],
    [{ n: 1, text: 'The summary mentions risk. It gives no percent.' }],
  );
  const text = retargetCites('The report says "risks rise 1.5 degrees by mid-century" and also claims 99 percent [1].', page, 'quote the official report');
  assert.match(text, /1\.5/);
  assert.match(text, /"/);
  assert.doesNotMatch(text, /99/);
});

test('an unpriced pick does not stay ahead of a priced one', () => {
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The Acme Switch is listed at $18.99.' },
    { n: 2, text: 'The generic splitter page describes the product and gives no price.' },
  ];
  const grid: CardNode = {
    type: 'grid',
    cols: 2,
    children: [
      { type: 'tile', label: 'Generic splitter', value: 'No price' },
      { type: 'tile', label: 'Acme Switch', value: '3 port' },
    ],
  };
  const next = bindClaims(grid, catalog, 'best hdmi switch under $40');
  const tiles = next.type === 'grid' ? next.children.filter((child) => child.type === 'tile') : [];
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0]?.type === 'tile' ? tiles[0].label : '', 'Acme Switch');
  assert.match(tiles[0]?.type === 'tile' ? `${tiles[0].value ?? ''} ${tiles[0].sub ?? ''}` : '', /\$18\.99/);
});

test('a number the person stated stays, and a stripped year does not leave a broken article', () => {
  const page = claimSources(
    [{ title: 'Bottled water', snippet: '', domain: 'pnas.org' }],
    [{ n: 1, text: 'An imaging study counted 110000 to 370000 particles per liter. The $110 line is a different topic.' }],
  );
  const study = retargetCites('A 2024 imaging study counted 110,000 to 370,000 particles per liter [1].', page, 'microplastics in bottled water');
  assert.doesNotMatch(study, /\bA imaging\b/);
  assert.doesNotMatch(study, /2024/);
  assert.match(study, /110,000/);
  const price = retargetCites('At $150 the sneakers cross the $110 threshold [1].', page, 'What if the same sneakers are $150?');
  assert.match(price, /\$150/);
});

test('a figure the sources state for the thing asked stays when the page read misses it', () => {
  const page = claimSources(
    [{ title: 'Heater guide', snippet: 'The portable heater draws 4.2W while it is running.', domain: 'reviews.example' }],
    [{ n: 1, text: 'A buying guide. The power figure is not in the extracted text.' }],
  );
  const hero = bindClaims(
    { type: 'hero', value: '4.2W', label: 'Draw' },
    page,
    'portable heater wattage',
  );
  assert.equal(hero.type === 'hero' ? hero.value : '', '4.2W');
});

test('a fetched page, not its snippet, is what a cited number has to match', () => {
  const page = claimSources(
    [{ title: 'Wolf news', snippet: 'The DNR counted 2,900 wolves.', domain: 'www.mprnews.org' }],
    [{ n: 1, text: 'A feature about the survey. It does not give a population figure.' }],
  );
  const text = retargetCites('Minnesota has about 2,900 wolves [1].', page);
  assert.doesNotMatch(text, /2,900/);
  const asked = retargetCites('Minnesota has about 2,900 wolves [1].', page, 'How many wolves are in Minnesota?');
  assert.doesNotMatch(asked, /2,900/);
  const percent = retargetCites('A review found 15% of users lost weight [1].', page);
  assert.doesNotMatch(percent, /%|15/);
});

test('an agency label stays only when the cited host is that agency', () => {
  const news: ClaimSource[] = [{ n: 1, text: 'The 2023 count was 2,294 wolves.', domain: 'www.mprnews.org' }];
  const tile: CardNode = { type: 'tile', label: 'Latest DNR estimate', value: '2,294', sub: 'DNR, 2023', source: 1 };
  const next = bindClaims(tile, news, 'How many wolves are in Minnesota?');
  assert.doesNotMatch(next.type === 'tile' ? `${next.label} ${next.sub ?? ''}` : '', /DNR/);
  assert.match(next.type === 'tile' ? next.sub ?? '' : '', /2023/);
  const prose: CardNode = { type: 'text', text: "The count was 2,294, per the Minnesota DNR's latest estimate [1]." };
  const said = bindClaims(prose, news, 'How many wolves are in Minnesota?');
  const body = said.type === 'text' ? said.text : '';
  assert.doesNotMatch(body, /DNR/);
  assert.match(body, /2,294/);
  const dnr: ClaimSource[] = [{ n: 1, text: 'The 2023 count was 2,294 wolves.', domain: 'files.dnr.state.mn.us' }];
  const kept = bindClaims(tile, dnr, 'How many wolves are in Minnesota?');
  assert.match(kept.type === 'tile' ? kept.sub ?? '' : '', /DNR/);
});

test('a product list drops a pick that has no price and keeps one that does', () => {
  assert.equal(shoppingAsk('best hdmi cable for a tv'), true);
  assert.equal(shoppingAsk('best ways to sleep'), false);
  const catalog: ClaimSource[] = [
    { n: 1, text: 'The MonoPrice cable is $8.99. Another listing has no price.' },
  ];
  const list: CardNode = {
    type: 'list',
    style: 'number',
    items: [{ text: 'MonoPrice HDMI cable' }, { text: 'No name cable' }],
  };
  const next = bindClaims(list, catalog, 'best hdmi cable for a tv');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.meta, '$8.99');
});

test('a table drops a number no page states', () => {
  const table: CardNode = { type: 'table', columns: ['Year', 'Estimate'], rows: [['2024', '2,900']] };
  const next = bindClaims(table, sources, 'How many wolves are in Minnesota?');
  assert.equal(next.type === 'table' ? next.rows[0]?.[1] : '', '');
});

test('a yes is removed when the named work never sits next to that person', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = [
    { type: 'tile', label: 'Courteney Cox', value: 'Yes', sub: 'Dancing in the Dark' },
    { type: 'tile', label: 'Jennifer Aniston', value: 'Yes', sub: 'I\'ll Be There for You' },
    { type: 'tile', label: 'Matt LeBlanc', value: 'Yes', sub: 'Bon Jovi Miracle' },
    { type: 'tile', label: 'Lisa Kudrow', value: 'Yes', sub: 'I (Wanna) Channing All Over Your Tatum' },
  ];
  const pages: ClaimSource[] = [
    { n: 1, text: 'Courteney Cox appeared in the Bruce Springsteen music video Dancing in the Dark.' },
    { n: 2, text: 'Jennifer Aniston appeared with the Rembrandts in the music video for I\'ll Be There for You.' },
    { n: 3, text: 'Matt LeBlanc starred in the Jon Bon Jovi music video Miracle.' },
    { n: 4, text: 'The music video I Wanna Channing All Over Your Tatum features Channing Tatum, Jamie Foxx and Matt Damon.' },
    { n: 5, text: 'The Friends cast includes Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
  ];
  const next = groundMembers(query, nodes, pages);
  const tiles = (next ?? []).filter((node) => node.type === 'tile');
  const valueOf = (label: string) => {
    const tile = tiles.find((node) => node.type === 'tile' && node.label === label);
    return tile && tile.type === 'tile' ? tile.value : '';
  };
  assert.equal(valueOf('Courteney Cox'), 'Yes');
  assert.equal(valueOf('Jennifer Aniston'), 'Yes');
  assert.equal(valueOf('Matt LeBlanc'), 'Yes');
  assert.equal(valueOf('Lisa Kudrow'), 'No');
  assert.equal(groundMembers('Who is Michael Jordan?', nodes, pages), undefined);
});

test('a century ordinal stays when the page states the year and not those digits', () => {
  const query = 'In what century was the current name of this day chosen?';
  const pages: ClaimSource[] = [
    { n: 1, text: 'The name dates back to the 18th century. The current name was chosen in 1814.' },
  ];
  const text = retargetCites('The current name was chosen in the 19th century [1].', pages, query);
  assert.match(text, /19th century/);
  const kv: CardNode = { type: 'keyvalue', items: [{ label: 'Name chosen', value: '19th century' }] };
  const next = bindClaims(kv, pages, query);
  assert.match(JSON.stringify(next), /19th century/);
});

test('an abstaining cast card names only the people a source credits alone', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = [
    { type: 'text', text: 'The sources provided don\'t name any of the six main Friends cast members appearing in a music video, so this can\'t be answered from them.' },
  ];
  const pages: ClaimSource[] = [
    { n: 1, title: 'These Are The Music Videos Jennifer Aniston Appeared In', text: 'Jennifer Aniston appeared in Melissa Etheridge\'s music video. Friends cast notes.' },
    { n: 2, title: 'Courteney Cox music video', text: 'Friends star Courteney Cox appeared in Bruce Springsteen\'s music video for Dancing in the Dark.' },
    { n: 3, title: 'Famous actors in music videos', text: 'Courteney Cox is not the only Friends star in a music video. Matt LeBlanc can be seen in a music video from before Friends.' },
    { n: 4, title: 'Friends cast', text: 'Main cast: Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
    { n: 5, title: 'Theme video', text: 'The music video features the Friends main cast: Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
  ];
  const next = groundMembers(query, nodes, pages) ?? [];
  const blob = JSON.stringify(next);
  assert.match(blob, /Jennifer Aniston/);
  assert.match(blob, /Courteney Cox/);
  assert.match(blob, /Matt LeBlanc/);
  assert.doesNotMatch(blob, /Lisa Kudrow/);
  assert.doesNotMatch(blob, /Bruce Springsteen/);
  assert.doesNotMatch(blob, /can.t be answered/);
  const tiles = next.flatMap((node) => node.type === 'grid' ? node.children : node.type === 'stack' ? node.children.flatMap((child) => child.type === 'grid' ? child.children : []) : []);
  const yes = tiles.filter((node) => node.type === 'tile' && node.value === 'Yes').map((node) => node.type === 'tile' ? node.label : '');
  assert.deepEqual(yes.filter((name) => /Kudrow|Springsteen|Perry|Schwimmer|Etheridge/.test(name)), []);
});

test('the person next to the verb is credited, and a theme-song list is not', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = [
    { type: 'tile', label: 'Jennifer Aniston', value: 'No' },
    { type: 'tile', label: 'Courteney Cox', value: 'No' },
    { type: 'tile', label: 'Lisa Kudrow', value: 'No' },
    { type: 'tile', label: 'Matt LeBlanc', value: 'No' },
    { type: 'tile', label: 'Joey Tribbiani', value: 'Yes' },
  ];
  const pages: ClaimSource[] = [
    { n: 1, text: 'Courteney Cox is not the only Friends star to make this list, and to have been in a music video. Matt LeBlanc can be seen in one too.' },
    { n: 2, text: 'Before he became Joey Tribbiani, Matt LeBlanc appeared in more than one music video.' },
    { n: 3, text: 'The Friends theme song music video has appearances by Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
    { n: 4, text: 'Jennifer Aniston appeared in Melissa Etheridge\'s music video.' },
  ];
  const next = groundMembers(query, nodes, pages) ?? nodes;
  const valueOf = (label: string) => {
    const tile = next.find((node) => node.type === 'tile' && node.label === label);
    return tile && tile.type === 'tile' ? tile.value : '';
  };
  assert.equal(valueOf('Courteney Cox'), 'Yes');
  assert.equal(valueOf('Matt LeBlanc'), 'Yes');
  assert.equal(valueOf('Jennifer Aniston'), 'Yes');
  assert.equal(valueOf('Lisa Kudrow'), 'No');
  assert.equal(valueOf('Joey Tribbiani'), 'No');
  const band: CardNode[] = [{ type: 'tile', label: 'The Rembrandts', value: 'Yes', sub: 'I\'ll Be There for You' }];
  const withCast: ClaimSource[] = [
    ...pages,
    { n: 5, text: 'Friends main cast: Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer. The Rembrandts appeared in the music video with them.' },
  ];
  const dropped = groundMembers(query, band, withCast) ?? band;
  const bandTile = dropped.find((node) => node.type === 'tile' && node.label === 'The Rembrandts');
  assert.equal(bandTile && bandTile.type === 'tile' ? bandTile.value : '', 'No');
});

test('a shared theme credit is not a yes, and a follow-on sentence still credits that person', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = [
    { type: 'hero', value: '6 of 6', label: 'Friends main cast in music videos', caption: 'All six appeared in the theme video' },
    {
      type: 'table',
      columns: ['Cast member', 'Music video', 'Year'],
      rows: [
        ['Jennifer Aniston', 'I\'ll Be There for You (The Rembrandts)', '1995'],
        ['Courteney Cox', 'I\'ll Be There for You (The Rembrandts)', '1995'],
        ['Lisa Kudrow', 'I\'ll Be There for You (The Rembrandts)', '1995'],
        ['Matt LeBlanc', 'I\'ll Be There for You (The Rembrandts)', '1995'],
        ['Matthew Perry', 'I\'ll Be There for You (The Rembrandts)', '1995'],
        ['David Schwimmer', 'I\'ll Be There for You (The Rembrandts)', '1995'],
      ],
    },
    { type: 'text', text: 'All six appeared in the theme video.' },
  ];
  const pages: ClaimSource[] = [
    { n: 1, text: 'Courteney Cox isn\'t the only Friends star to make this list, and to have been in a music video. Matt LeBlanc can be seen in one too.' },
    { n: 2, text: 'Jennifer Aniston appeared in Melissa Etheridge\'s music video.' },
    { n: 3, text: 'The Friends theme song music video has appearances by Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
    { n: 4, text: 'Main cast: Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
  ];
  const next = groundMembers(query, nodes, pages) ?? nodes;
  const hero = next.find((node) => node.type === 'hero');
  assert.equal(hero && hero.type === 'hero' ? hero.value : '', '3');
  assert.match(hero && hero.type === 'hero' ? hero.caption ?? '' : '', /Aniston/);
  assert.match(hero && hero.type === 'hero' ? hero.caption ?? '' : '', /Cox/);
  assert.match(hero && hero.type === 'hero' ? hero.caption ?? '' : '', /LeBlanc/);
  const table = next.find((node) => node.type === 'table');
  const rows = table && table.type === 'table' ? table.rows : [];
  const cell = (name: string) => rows.find((row) => row[0] === name)?.[1] ?? '';
  assert.equal(cell('Jennifer Aniston'), 'Yes');
  assert.equal(cell('Courteney Cox'), 'Yes');
  assert.equal(cell('Matt LeBlanc'), 'Yes');
  assert.equal(cell('Lisa Kudrow'), 'No');
  assert.equal(cell('Matthew Perry'), 'No');
  assert.equal(cell('David Schwimmer'), 'No');
  assert.doesNotMatch(JSON.stringify(next), /All six appeared/);
  assert.doesNotMatch(JSON.stringify(rows), /1995/);
});

test('a roundup title does not take the credit away from the person in the sentence', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = ['Jennifer Aniston', 'Courteney Cox', 'Lisa Kudrow', 'Matt LeBlanc', 'Matthew Perry', 'David Schwimmer']
    .map((label) => ({ type: 'tile' as const, label, value: 'No' }));
  const pages: ClaimSource[] = [
    { n: 1, title: '49 Famous Actors in Music Videos', text: 'Courteney Cox isn\'t the only Friends star to make this list, and to have been in a music video. Matt LeBlanc can be seen in one too.' },
    { n: 2, title: 'List of Friends Cast Members', text: 'Main Cast · Jennifer Aniston is an actress. · Courteney Cox is an actress. · Lisa Kudrow is an actress.' },
  ];
  const next = groundMembers(query, nodes, pages) ?? nodes;
  const valueOf = (label: string) => {
    const tile = next.find((node) => node.type === 'tile' && node.label === label);
    return tile && tile.type === 'tile' ? tile.value : '';
  };
  assert.equal(valueOf('Courteney Cox'), 'Yes');
  assert.equal(valueOf('Matt LeBlanc'), 'Yes');
  assert.equal(valueOf('Lisa Kudrow'), 'No');
  assert.equal(valueOf('Jennifer Aniston'), 'No');
});

test('a table No turns Yes for a cast member a source credits alone', () => {
  const query = 'Of the 6 main cast members of the series Friends, which have appeared in music videos?';
  const nodes: CardNode[] = [
    {
      type: 'table',
      columns: ['Cast member', 'Music video?', 'Note'],
      rows: [
        ['Courteney Cox', 'No', ''],
        ['Matt LeBlanc', 'No', ''],
        ['Lisa Kudrow', 'No', 'No music video credit found'],
      ],
    },
    { type: 'keyvalue', items: [{ label: 'Courteney Cox', value: 'Bruce Springsteen, "Dancing in the Dark" (1984) [3]' }] },
  ];
  const pages: ClaimSource[] = [
    { n: 1, text: 'Main cast: Jennifer Aniston, Courteney Cox, Lisa Kudrow, Matt LeBlanc, Matthew Perry and David Schwimmer.' },
    { n: 3, text: 'Courteney Cox appeared in Bruce Springsteen\'s music video for Dancing in the Dark. Matt LeBlanc appeared in Jon Bon Jovi\'s music video for Miracle.' },
  ];
  const next = groundMembers(query, nodes, pages) ?? nodes;
  const table = next.find((node) => node.type === 'table');
  const rows = table && table.type === 'table' ? table.rows : [];
  assert.deepEqual(rows.find((row) => row[0] === 'Courteney Cox'), ['Courteney Cox', 'Yes', '']);
  assert.equal(rows.find((row) => row[0] === 'Matt LeBlanc')?.[1], 'Yes');
  assert.deepEqual(rows.find((row) => row[0] === 'Lisa Kudrow'), ['Lisa Kudrow', 'No', 'No music video credit found']);
});

test('a month abbreviation is not a sentence break, so no citation lands inside a date', () => {
  const pages: ClaimSource[] = [
    { n: 1, text: 'Walt Disney World opened on October 1, 1971. Its 50th anniversary was celebrated in 2021.' },
    { n: 3, text: 'Remy\'s Ratatouille Adventure opened Oct. 1, 2021, exactly 50 years after the park opened.' },
  ];
  const text = retargetCites('Exactly 50 years later, on Oct. 1, 2021, Remy\'s Ratatouille Adventure opened [3].', pages);
  assert.doesNotMatch(text, /Oct\.\s*\[\d+\]/);
  assert.match(text, /Oct\. 1, 2021/);
});

test('a citation written after the full stop stays on its sentence and is not added again', () => {
  const pages: ClaimSource[] = [
    { n: 1, title: 'Apple pie recipe', text: 'Bake the pie at 425F for about 42 minutes until golden.' },
    { n: 2, title: 'Crust tips', text: 'Use cold butter for a flaky crust.' },
  ];
  assert.equal(retargetCites('Bake the pie at 425F for about 42 minutes until golden. [1]', pages), 'Bake the pie at 425F for about 42 minutes until golden. [1]');
  assert.equal(retargetCites('Bake at 425F for about 42 minutes. [2]', pages), 'Bake at 425F for about 42 minutes. [1]');
});

test('a quotation is the source sentence, whole, and a paraphrase loses its quote marks', async () => {
  const { wholeQuotes } = await import('../server/claims.ts');
  const pages: ClaimSource[] = [{ n: 1, text: 'Physical activity is key. According to the Physical Activity Guidelines for Americans, adults need at least 150 to 300 minutes of moderate-intensity aerobic activity a week. They also need muscle-strengthening activity.' }];
  assert.equal(
    wholeQuotes('"Americans, adults need at least 150 to 300 minutes of moderate-intensity aerobic activity a week." [1]', pages),
    '"According to the Physical Activity Guidelines for Americans, adults need at least 150 to 300 minutes of moderate-intensity aerobic activity a week." [1]',
  );
  assert.equal(wholeQuotes('The guideline says "adults should move a lot more every single day of the week".', pages), 'The guideline says adults should move a lot more every single day of the week.');
  const exact = 'WHO says "They also need muscle-strengthening activity."';
  assert.equal(wholeQuotes(exact, pages), exact);
});

test('a slightly reworded quote becomes the sentence the source wrote', async () => {
  const { wholeQuotes } = await import('../server/claims.ts');
  const who: ClaimSource[] = [{ n: 1, text: 'WHO recommends adults and children reduce their daily intake of free sugars to less than 10% of their total energy intake. A further reduction to below 5% would provide additional health benefits.' }];
  assert.equal(
    wholeQuotes('"WHO guideline recommends adults and children reduce their daily intake of free sugars to less than 10% of their total energy intake." 1', who),
    '"WHO recommends adults and children reduce their daily intake of free sugars to less than 10% of their total energy intake." 1',
  );
});

test('a line that already gives the combined rate keeps its parts and ranges', () => {
  const pages: ClaimSource[] = [
    { n: 1, text: 'The combined sales tax rate in New York City is 8.875%: 4% state, 4.5% city and 0.375% MCTD. Rates in New York State range from 7% to 8.875%.' },
  ];
  const ask = 'What would I pay with sales tax in New York City on a $499.99 console?';
  const parts = bindClaims({ type: 'text', text: 'The 8.875% combines the 4% state rate, 4.5% city rate and 0.375% MCTD surcharge [1].' }, pages, ask);
  assert.match(parts.type === 'text' ? parts.text : '', /4\.5%/);
  const range = bindClaims({ type: 'text', text: 'Rates in New York State range from 7% to 8.875% [1].' }, pages, ask);
  assert.match(range.type === 'text' ? range.text : '', /from 7% to 8\.875%/);
});

test('a draft keeps its own times and amounts: it is writing, not a sourced claim', () => {
  const pages: ClaimSource[] = [{ n: 1, text: 'Name the miss in the first line. Skip excuses.' }];
  const text = 'Hi Sam, I am sorry I missed our 3 pm meeting today. Could we find 30 minutes tomorrow? Thanks for your patience, Alex';
  const next = bindClaims({ type: 'draft', text }, pages, 'make it shorter');
  assert.equal(next.type === 'draft' ? next.text : '', text);
});

test('a dash between two phrases is punctuation, and a dash where a figure belongs is a hole', async () => {
  const { withoutEmptySlots } = await import('../server/polish.ts');
  assert.equal(withoutEmptySlots('STEP 4 — continued semaglutide vs placebo for weight-loss maintenance'), 'STEP 4 — continued semaglutide vs placebo for weight-loss maintenance');
  assert.equal(withoutEmptySlots('Lisa Su — AMD chief executive — joined in 2012.'), 'Lisa Su — AMD chief executive — joined in 2012.');
  assert.equal(withoutEmptySlots('He was born in — and moved to Paris.'), 'He was born and moved to Paris.');
  assert.equal(withoutEmptySlots('Rates rose to — percent last year.'), '');
  assert.equal(withoutEmptySlots('The tower is — feet tall.'), '');
  assert.equal(withoutEmptySlots('Population — [3].'), '');
});

test('a hero written with a title and subtitle leads with its title', async () => {
  const { sanitizeNodes } = await import('../server/sanitize.ts');
  const [hero] = sanitizeNodes([{ type: 'hero', title: 'Anker Soundcore Space Q45', subtitle: 'The best budget noise cancelling headphones we have tested [8]' }], 0);
  assert.equal(hero?.type === 'hero' ? `${hero.value} | ${hero.caption}` : '', 'Anker Soundcore Space Q45 | The best budget noise cancelling headphones we have tested [8]');
});

test('a tax card keeps each component rate and aligns only the combined one', async () => {
  const { bindClaims } = await import('../server/claims.ts');
  const sources = [{ n: 1, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%: 4% New York State, 4.5% city, and 0.375% MCTD.' }];
  const grid: CardNode = { type: 'grid', cols: 2, children: [
    { type: 'tile', label: 'Combined rate', value: '8.875% [1]' },
    { type: 'tile', label: 'City sales tax', value: '4.5% [1]' },
    { type: 'tile', label: 'NY State sales tax', value: '4% [1]' },
    { type: 'tile', label: 'MCTD surcharge', value: '0.375% [1]' },
  ] };
  const bound = bindClaims(grid, sources as never, 'What would I pay with sales tax in New York City?');
  assert.deepEqual(bound.type === 'grid' ? bound.children.map((tile) => (tile.type === 'tile' ? tile.value : '')) : [], ['8.875% [1]', '4.5% [1]', '4% [1]', '0.375% [1]']);
});

test('a rate the row places somewhere else keeps its figure', async () => {
  const { bindClaims } = await import('../server/claims.ts');
  const sources = [{ n: 1, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%. Purchase, NY: 8.375%.' }];
  const grid: CardNode = { type: 'grid', cols: 2, children: [
    { type: 'tile', label: 'NYC rate', value: '8.875% [1]' },
    { type: 'tile', label: 'Purchase, NY rate', value: '8.375% [1]', sub: 'Outside NYC, lower rate' },
  ] };
  const bound = bindClaims(grid, sources as never, 'What would I pay with sales tax in New York City?');
  assert.deepEqual(bound.type === 'grid' ? bound.children.map((tile) => (tile.type === 'tile' ? tile.value : '')) : [], ['8.875% [1]', '8.375% [1]']);
});

test('a fee percentage is not rewritten to the sales tax rate', async () => {
  const { bindClaims } = await import('../server/claims.ts');
  const sources = [{ n: 1, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%. Nintendo charges a 1.5% recycling fee, capped at $15.' }];
  const text: CardNode = { type: 'text', text: 'Nintendo adds a separate fee of 1.5% of the retail price, capped at $15 [1].' };
  const bound = bindClaims(text, sources as never, 'What would I pay with sales tax in New York City?');
  assert.equal(bound.type === 'text' ? bound.text : '', 'Nintendo adds a separate fee of 1.5% of the retail price, capped at $15 [1].');
});

test('the finished-card rate pass keeps a breakdown\'s parts', async () => {
  const { agreeOfficialRate } = await import('../server/claims.ts');
  const sources = [{ n: 4, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%: 4% New York State, 4.5% city, and 0.375% MCTD.' }];
  const grid: CardNode = { type: 'grid', cols: 3, children: [
    { type: 'tile', label: 'NYC local sales tax', value: '4.5% [4]' },
    { type: 'tile', label: 'NY State sales and use tax', value: '4% [4]' },
    { type: 'tile', label: 'MCTD surcharge', value: '0.375% [4]' },
  ] };
  const next = agreeOfficialRate(grid, 'What would I pay with sales tax in New York City?', sources as never);
  assert.deepEqual(next.type === 'grid' ? next.children.map((tile) => (tile.type === 'tile' ? tile.value : '')) : [], ['4.5% [4]', '4% [4]', '0.375% [4]']);
});

test('a breakdown written as stats keeps each part, with the percent sign in its unit', async () => {
  const { agreeOfficialRate, bindClaims } = await import('../server/claims.ts');
  const sources = [{ n: 2, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%: 4% New York State, 4.5% city, and 0.375% MCTD.' }];
  const grid: CardNode = { type: 'grid', cols: 2, children: [
    { type: 'stat', label: 'NYC combined tax', value: '8.875', unit: '%' },
    { type: 'stat', label: 'City portion', value: '4.5', unit: '%' },
    { type: 'stat', label: 'State portion', value: '4', unit: '%' },
  ] };
  const ask = 'What would I pay with sales tax in New York City?';
  for (const next of [bindClaims(grid, sources as never, ask), agreeOfficialRate(grid, ask, sources as never)]) {
    assert.deepEqual(next.type === 'grid' ? next.children.map((stat) => (stat.type === 'stat' ? stat.value : '')) : [], ['8.875', '4.5', '4']);
  }
});

test('a fee tile keeps its own percent under the label', async () => {
  const { bindClaims } = await import('../server/claims.ts');
  const sources = [{ n: 1, text: 'NYC sales tax. The combined sales tax rate in New York City is 8.875%. Nintendo charges a 1.5% recycling fee, capped at $15.' }];
  const tile: CardNode = { type: 'tile', label: 'Nintendo fee cap', value: '$15', sub: '1.5% of retail [1]' };
  const bound = bindClaims(tile, sources as never, 'What would I pay with sales tax in New York City?');
  assert.equal(bound.type === 'tile' ? bound.sub : '', '1.5% of retail [1]');
});

test('a surcharge under one percent is never the sales tax a purchase pays', async () => {
  const { salesTax } = await import('../server/claims.ts');
  const sources = [
    { n: 1, domain: 'www.tax.ny.gov', text: 'Metropolitan Commuter Transportation District. New York City: the MCTD surcharge rate is 0.375%.' },
    { n: 2, domain: 'www.avalara.com', text: 'The combined sales tax rate in New York City is 8.875%.' },
  ];
  assert.equal(salesTax('What would I pay with sales tax in New York City?', sources as never)?.rate, 8.875);
  assert.equal(salesTax('What is the MCTD surcharge in New York City sales tax?', sources as never)?.rate, 0.375);
});

test('what a purchase pays is the combined rate, not an official page\'s city piece', async () => {
  const { salesTax } = await import('../server/claims.ts');
  const sources = [
    { n: 3, domain: 'www.nyc.gov', text: 'NYC sales tax. Every taxable item in New York City is charged the full 4.5% city rate.' },
    { n: 5, domain: 'www.avalara.com', text: 'The combined sales tax rate in New York City is 8.875%.' },
  ];
  assert.equal(salesTax('What would I pay with sales tax in New York City?', sources as never)?.rate, 8.875);
});
