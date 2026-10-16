import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CardNode } from '../shared/card.ts';
import { answerTitle, finishQuotedText, restoreKeptPapers } from '../server/cardAgree.ts';
import { bindClaims, type ClaimSource } from '../server/claims.ts';
import { finishQuality } from '../server/sourceQuality.ts';

const page = (text: string, n = 1, domain?: string): ClaimSource => ({ n, text, domain });

test('a truncated quotation is finished from the source sentence, numbers included', () => {
  const source = 'Visitors must leave the ridge by 4:30 p.m. when wind exceeds 40 miles per hour. The gate closes after that.';
  const cut = '"Visitors must leave the ridge by 4."';
  const next = finishQuotedText('quote the notice about the ridge wind rule', cut, [page(source)]);
  assert.match(next, /4:30 p\.m\./);
  assert.match(next, /40 miles per hour/);
  assert.match(next, /"$/);
});

test('a nearby sentence is not the quote when another sentence answers', () => {
  const source = 'The park opens at 8. Trail closures grow longer each time the rain threshold is crossed, and 12 paths shut. Picnic areas stay open all season.';
  const quoted = '"The park opens at 8."';
  const next = finishQuotedText('quote the parks page on how trail closures change in heavy rain', quoted, [page(source)]);
  assert.match(next, /Trail closures grow longer/);
  assert.match(next, /12 paths/);
  assert.doesNotMatch(next, /opens at 8/);
});

test('a quotation that already answers is left whole', () => {
  const source = 'Trail closures grow longer each time the rain threshold is crossed, and 12 paths shut.';
  const quoted = '"Trail closures grow longer each time the rain threshold is crossed, and 12 paths shut."';
  const next = finishQuotedText('quote the parks page on trail closures in the rain', quoted, [page(source)]);
  assert.equal(next, quoted);
});

test('a page that does not name the study design is not given one', () => {
  const sources = [page('The writeup describes the method and the sample. It never names the article type.')];
  const next = bindClaims({ type: 'text', text: 'The other is an original study.' }, sources, 'which of these papers is a review');
  assert.equal(next.type === 'text' ? next.text : '', 'The page does not say whether this is a review or an original study.');
  const stated = bindClaims(
    { type: 'text', text: 'This one is a systematic review.' },
    [page('This paper is a systematic review of the trials.')],
    'which of these papers is a review',
  );
  assert.match(stated.type === 'text' ? stated.text : '', /systematic review/);
});

test('a peer-reviewed list keeps only papers a source identifies', () => {
  const sources = [
    page('Harbor trial of the device. DOI 10.2000/harbor.1', 1, 'doi.org'),
    page('A clinic recap of the device with no identifier.', 2, 'healthline.com'),
  ];
  const list: CardNode = {
    type: 'list',
    items: [
      { text: 'Harbor trial of the device. DOI 10.2000/harbor.1' },
      { text: 'Clinic recap of the device. Mayo Clinic.' },
      { text: '"Sleep widgets and the invented trial"' },
    ],
  };
  const next = bindClaims(list, sources, 'peer-reviewed papers on the harbor device');
  const items = next.type === 'list' ? next.items : [];
  assert.equal(items.length, 1);
  assert.match(items[0]?.text ?? '', /10\.2000\/harbor\.1/);
});

test('a keep-only follow-up puts back a paper that still qualifies', () => {
  const sources = [
    page('Harbor trial of the device. DOI 10.2000/harbor.1', 1, 'doi.org'),
    page('Second harbor measurement. DOI 10.2000/harbor.2', 2, 'doi.org'),
  ];
  const base: CardNode[] = [{
    type: 'list',
    items: [
      { text: 'Harbor trial of the device. DOI 10.2000/harbor.1' },
      { text: 'Second harbor measurement. DOI 10.2000/harbor.2' },
    ],
  }];
  const shrunk: CardNode[] = [{ type: 'list', items: [{ text: 'Harbor trial of the device. DOI 10.2000/harbor.1' }] }];
  const next = restoreKeptPapers('keep only the peer-reviewed ones', shrunk, base, sources);
  const items = next[0]?.type === 'list' ? next[0].items : [];
  assert.equal(items.length, 2);
});

test('a quotation the page does not contain is not shown', () => {
  const source = 'The recommended amount of sleep for adults is at least 7 hours each day.';
  const smashed = 'The page states: "About Sleep Adult 65 years and older 7-8 hours1."';
  const next = finishQuotedText('quote the page on how much sleep adults need', smashed, [page(source)]);
  assert.match(next, /at least 7 hours/);
  assert.doesNotMatch(next, /hours1/);
});

test('a follow-up title answers where someone teaches and what a price would cost in tax', () => {
  assert.equal(answerTitle('Where does she teach?', 'Ada Lovelace', 'She teaches at Northshore University.'), 'Northshore University');
  const card = JSON.stringify([{ type: 'hero', value: 'UC Berkeley' }, { type: 'text', text: 'She is also an investigator at the Howard Hughes Medical Institute.' }]);
  assert.equal(answerTitle('Where does she teach?', 'Jennifer Doudna', card), 'UC Berkeley');
  assert.equal(answerTitle('What if they cost $80?', 'Sneakers', 'The purchase is taxable. Tax $6.40 at the combined rate.'), 'Tax $6.40');
  assert.equal(answerTitle('Who is Ada Lovelace?', 'Ada Lovelace', 'She teaches at Northshore University.'), 'Ada Lovelace');
});

test('a shopping count matches the rows, the headline price matches the row, and an over-budget pick does not lead', () => {
  const nodes: CardNode[] = [
    { type: 'hero', value: 'Acme kettle', label: 'Pick', caption: 'The cheapest of the three. The Acme kettle is $24.' },
    { type: 'table', columns: ['Model', 'Price'], rows: [['Acme kettle', '$22'], ['Bravo kettle', '$58']] },
  ];
  const out = finishQuality('best kettle under $40', nodes);
  const hero = out.find((node) => node?.type === 'hero');
  const caption = hero?.type === 'hero' ? hero.caption ?? '' : '';
  assert.match(caption, /\$22/);
  assert.doesNotMatch(caption, /\$24/);
  assert.match(caption, /of the one|cheapest/i);
  assert.doesNotMatch(caption, /of the three/);
  const table = out.find((node) => node?.type === 'table');
  const rows = table?.type === 'table' ? table.rows : [];
  assert.equal(rows.length, 1);
  assert.match(rows[0]?.join(' ') ?? '', /Acme/);
});
