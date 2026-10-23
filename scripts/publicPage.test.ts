import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerSlug, publicAnswerFromFrames, renderAnswerHtml, shareCardFromFrames, shareView } from '../shared/publicPage.ts';
import { shareDocument } from '../shared/crawler.ts';
import { cardPng } from '../server/ogPng.ts';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('the same question always gets the same answer path', () => {
  assert.equal(answerSlug('  Kindle  vs Kobo? '), answerSlug('kindle vs kobo'));
  assert.match(answerSlug('Kindle vs Kobo'), /^kindle-vs-kobo-[a-f0-9]{8}$/);
});

test('a finished card becomes indexable HTML with its title, description, and body', () => {
  const page = publicAnswerFromFrames('Kindle vs Kobo', [
    frame('head', { title: 'Kindle and Kobo', subtitle: 'A side by side look' }),
    frame('node', { node: { type: 'text', text: 'Kindle is lighter. Kobo has more formats.' } }),
    frame('done', { engine: 'composed' }),
  ]);
  assert.ok(page);
  const html = renderAnswerHtml(page, 'https://zo2.pages.dev');
  assert.match(html, /<title>Kindle and Kobo · ZO<\/title>/);
  assert.match(html, /name="robots" content="index, follow"/);
  assert.match(html, /property="og:title" content="Kindle and Kobo"/);
  assert.doesNotMatch(html, /Good search should be free/);
  assert.match(html, /name="description" content="A side by side look"/);
  assert.match(html, /rel="canonical" href="https:\/\/zo2\.pages\.dev\/a\/kindle-vs-kobo-[a-f0-9]{8}"/);
  assert.match(html, /name="robots" content="index, follow"/);
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /Kindle is lighter\. Kobo has more formats\./);
  assert.match(html, /property="og:image" content="https:\/\/zo2\.pages\.dev\/og\/kindle-vs-kobo-[a-f0-9]{8}\.png"/);
});

test('a picker, an empty shell, and a degraded answer are not published', () => {
  assert.equal(
    publicAnswerFromFrames('Who is Ray Lee', [frame('done', { choices: [{ name: 'A' }] })]),
    undefined,
  );
  assert.equal(publicAnswerFromFrames('empty', [frame('done', { engine: 'composed' })]), undefined);
  assert.equal(
    publicAnswerFromFrames('down', [
      frame('node', { node: { type: 'text', text: 'nothing' } }),
      frame('notice', { degraded: true }),
      frame('done', { degraded: true }),
    ]),
    undefined,
  );
});

test('a published answer keeps the app card, including a portrait on the profile', () => {
  const portrait = 'https://media.licdn.com/dms/image/v2/D5603AQHexample/profile-displayphoto-shrink_200_200/0/1';
  const share = shareCardFromFrames('Who is Tim from Blueflame', [
    frame('head', { title: 'Timothy Estrada', subtitle: 'BlueFlame AI' }),
    frame('search', { query: 'Tim at Blueflame', results: [{ title: 'Timothy Estrada', url: 'https://www.linkedin.com/in/timothy-estrada', snippet: 'BlueFlame', domain: 'linkedin.com', image: portrait }] }),
    frame('node', { index: 0, node: { type: 'profile', name: 'Timothy Estrada', imageSrc: portrait, facts: [{ label: 'Work', value: 'BlueFlame AI' }] } }),
    frame('followups', ['What does BlueFlame AI build?']),
    frame('done', { engine: 'composed' }),
  ]);
  assert.ok(share);
  assert.equal(share.card.title, 'Timothy Estrada');
  assert.equal(share.card.body[0]?.type, 'profile');
  assert.equal(share.card.body[0] && 'imageSrc' in share.card.body[0] ? share.card.body[0].imageSrc : '', portrait);
  assert.equal(share.results[0]?.url, 'https://www.linkedin.com/in/timothy-estrada');
  assert.deepEqual(share.followups, ['What does BlueFlame AI build?']);
  const page = publicAnswerFromFrames('Who is Tim from Blueflame', [
    frame('head', { title: 'Timothy Estrada', subtitle: 'BlueFlame AI' }),
    frame('node', { index: 0, node: { type: 'profile', name: 'Timothy Estrada', imageSrc: portrait } }),
    frame('done', { engine: 'composed' }),
  ]);
  assert.ok(page);
  const view = shareView(page, share);
  assert.equal(view.card.title, 'Timothy Estrada');
  assert.equal(view.query, 'Who is Tim from Blueflame');
});

test('an older share with no stored card still opens as a card', () => {
  const page = {
    slug: 'tim-from-blueflame-abcd1234',
    query: 'Who is Tim from Blueflame',
    title: 'Timothy Estrada',
    description: 'BlueFlame AI',
    body: 'Timothy Estrada\nBlueFlame AI',
  };
  const view = shareView(page, undefined);
  assert.equal(view.card.title, 'Timothy Estrada');
  assert.equal(view.card.body.length, 2);
  assert.equal(view.card.body[0]?.type, 'text');
});

test('a browser opens the app and a crawler gets the page', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  assert.equal(shareDocument(chrome), 'app');
  assert.equal(shareDocument(''), 'app');
  assert.equal(shareDocument(null), 'app');
  assert.equal(shareDocument('curl/8.7.1'), 'app');
  assert.equal(shareDocument('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'page');
  assert.equal(shareDocument('Twitterbot/1.0'), 'page');
  assert.equal(shareDocument('facebookexternalhit/1.1'), 'page');
  assert.equal(shareDocument('LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'), 'page');
  assert.equal(shareDocument('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'), 'page');
  assert.equal(shareDocument('WhatsApp/2.23.20.0'), 'page');
  assert.equal(shareDocument('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.23.20.0'), 'app');
  assert.equal(shareDocument('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'), 'app');
});

test('a picker is not stored as a share card', () => {
  assert.equal(
    shareCardFromFrames('Who is Ray Lee', [frame('done', { choices: [{ name: 'A' }] })]),
    undefined,
  );
});

test('an answer card image is a PNG', async () => {
  const png = await cardPng('Kindle and Kobo');
  assert.equal(png[0], 137);
  assert.equal(png[1], 80);
  assert.equal(png[2], 78);
  assert.equal(png[3], 71);
  assert.ok(png.length > 1000);
});
