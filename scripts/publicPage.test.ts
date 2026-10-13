import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerSlug, publicAnswerFromFrames, renderAnswerHtml } from '../shared/publicPage.ts';
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
  assert.match(html, /<title>Kindle and Kobo — ZO<\/title>/);
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

test('an answer card image is a PNG', async () => {
  const png = await cardPng('Kindle and Kobo');
  assert.equal(png[0], 137);
  assert.equal(png[1], 80);
  assert.equal(png[2], 78);
  assert.equal(png[3], 71);
  assert.ok(png.length > 1000);
});
