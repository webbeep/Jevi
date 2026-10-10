import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateResults } from '../server/relevanceGate.ts';

const hit = (title: string, snippet: string, url: string) => ({ title, url, snippet });

test('2026 NBA preseason drops a 1995 draft page and keeps the player', () => {
  const q = 'How is Nique Clifford doing in the 2026 NBA preseason?';
  const draft = hit('1995 NBA draft', 'The 1995 NBA draft took place on June 28, 1995, in Toronto.', 'https://en.wikipedia.org/wiki/1995_NBA_draft');
  const tape = hit('Nique Clifford 1995 high school tape', 'Nique Clifford highlights from 1995.', 'https://example.com/nique-clifford-1995');
  const bio = hit('Nique Clifford', 'Nique Clifford is an American basketball player born in 2002.', 'https://en.wikipedia.org/wiki/Nique_Clifford');
  const season = hit('2025-26 NBA preseason notes', 'Nique Clifford in the 2025-26 NBA preseason.', 'https://example.com/nique-clifford-2026');
  const gated = gateResults(q, [draft, tape, bio, season]);
  assert.deepEqual(gated.kept.map((r) => r.title), ['Nique Clifford', '2025-26 NBA preseason notes']);
  assert.equal(gated.dropped, 2);
  assert.deepEqual(gateResults(q, [draft]), { kept: [], dropped: 1 });
});

test('a product ask keeps headphone pages and drops an unrelated recipe', () => {
  const q = 'best wireless headphones for running';
  const rtings = hit('Best wireless headphones for running', 'Top wireless headphones tested for running and the gym.', 'https://www.rtings.com/headphones/running');
  const wirecutter = hit('Running headphones buying guide', 'Wireless headphones that stay put while running.', 'https://www.nytimes.com/wirecutter/headphones');
  const pie = hit('Classic apple pie recipe', 'A flaky crust and cinnamon apples.', 'https://example.com/apple-pie');
  const gated = gateResults(q, [rtings, wirecutter, pie]);
  assert.deepEqual(gated.kept.map((r) => r.title), [rtings.title, wirecutter.title]);
  assert.equal(gated.dropped, 1);
});

test('a health ask keeps blood-pressure pages and drops an unrelated sports page', () => {
  const q = 'how to lower blood pressure naturally';
  const mayo = hit('10 ways to control high blood pressure', 'Lifestyle steps that help lower blood pressure without medication.', 'https://www.mayoclinic.org/diseases-conditions/high-blood-pressure');
  const nhs = hit('High blood pressure', 'Blood pressure can often be lowered with diet and exercise.', 'https://www.nhs.uk/conditions/high-blood-pressure');
  const draft = hit('1995 NBA draft', 'The 1995 NBA draft took place in Toronto.', 'https://en.wikipedia.org/wiki/1995_NBA_draft');
  const gated = gateResults(q, [mayo, nhs, draft]);
  assert.deepEqual(gated.kept.map((r) => r.title), [mayo.title, nhs.title]);
  assert.equal(gated.dropped, 1);
});

test('a nonsense ask that shares one of five words with a hit gets no sources', () => {
  const q = 'zxqv blorptastic quonkle frabjous r3uk0';
  const tiktok = hit('ZXQV (@gstopcat)', 'ZXQV (@gstopcat) on TikTok | 403K Likes. 2235 Followers.', 'https://www.tiktok.com/@gstopcat');
  assert.deepEqual(gateResults(q, [tiktok]), { kept: [], dropped: 1 });
});

test('a coffee and heart ask keeps the heart page and the caffeine page', () => {
  const q = 'is coffee bad for your heart';
  const heart = hit('Coffee and cardiovascular health', 'What the research says about coffee and your heart.', 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/nutrition-basics/coffee-and-your-heart');
  const mayo = hit('Caffeine: How Much Is Too Much?', 'Caffeine is a common stimulant found in tea, soda and energy drinks.', 'https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20045678');
  const gated = gateResults(q, [heart, mayo]);
  assert.deepEqual(gated.kept.map((r) => r.title), [heart.title, mayo.title]);
  assert.equal(gated.dropped, 0);
});

test('a misspelled company keeps the LinkedIn page that prints only a last initial', () => {
  const q = 'Ricky Cheuk Bleuflame AI';
  const linkedin = hit('Ricky C.', 'Software Engineer at Blueflame AI. New York.', 'https://www.linkedin.com/in/rickycheuk');
  const rugby = hit('Ricky C.', 'Hong Kong rugby player Ricky C.', 'https://hkrugby.example/r');
  const namesake = hit('Ricky Cheuk - Hong Kong rugby', 'Former Hong Kong international rugby player Ricky Cheuk.', 'https://hkrugby.example/ricky');
  const gated = gateResults(q, [rugby, namesake, linkedin]);
  assert.deepEqual(gated.kept.map((r) => r.url), [linkedin.url]);
  assert.equal(gated.dropped, 2);
});

test('a one-word ask about an odd name keeps the single hit that carries it', () => {
  const q = 'zxqv';
  const tiktok = hit('ZXQV (@gstopcat)', 'ZXQV (@gstopcat) on TikTok | 403K Likes. 2235 Followers.', 'https://www.tiktok.com/@gstopcat');
  assert.deepEqual(gateResults(q, [tiktok]), { kept: [tiktok], dropped: 0 });
});
