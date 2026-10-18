import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distinguishingTerms, hasFullPersonName } from '../server/entity.ts';
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

test('a misspelled company keeps the page whose text, not its snippet, names the company', () => {
  const q = 'Ricky Cheuk Bleuflame AI';
  const linkedin = hit(
    'Ricky C.',
    'View Ricky’s profile on LinkedIn.',
    'https://www.linkedin.com/in/rickycheuk',
  );
  (linkedin as { content?: string }).content = 'Software Engineer at Blueflame AI. New York. Building AI stuff.';
  const rugby = hit('Ricky Cheuk - Hong Kong rugby', 'Former Hong Kong international rugby player.', 'https://hkrugby.example/ricky');
  const gated = gateResults(q, [rugby, linkedin]);
  assert.deepEqual(gated.kept.map((r) => r.url), [linkedin.url]);
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

test('a numbered product drops the previous model and keeps the one that was asked', () => {
  const q = 'Google Fitbit Edge vs Xiaomi Miband 11';
  const edge = hit('Google Fitbit Edge specs', 'Launched 12 Oct 2026. 1.34-inch AMOLED, GPS, ECG and SpO2.', 'https://www.fitbit.com/edge');
  const band11 = hit('Xiaomi Mi Band 11 review', 'The Mi Band 11 adds a larger screen. It follows the Mi Band 10.', 'https://www.youtube.com/watch?v=abcdefghijk');
  const band4 = hit('Xiaomi Mi Band 4 vs Fitbit Inspire HR', 'Mi Band 4 specs and pricing compared with the Inspire HR.', 'https://www.wareable.com/xiaomi/mi-band-4-review');
  const gated = gateResults(q, [band4, edge, band11]);
  assert.deepEqual(gated.kept.map((r) => r.title), [edge.title, band11.title]);
  assert.equal(gateResults('Xiaomi Miband 11', [band4, band11]).kept.map((r) => r.title).join('|'), band11.title);
  const asked = 'iphone 17 vs pixel 10';
  const iphone = hit('iPhone 17 battery life', 'The iPhone 17 battery is rated for 30 hours of video playback.', 'https://www.apple.com/iphone-17');
  const old = hit('iPhone 16 review', 'iPhone 16 specs and pricing.', 'https://www.theverge.com/iphone-16');
  assert.deepEqual(gateResults(asked, [old, iphone]).kept.map((r) => r.title), [iphone.title]);
});

test('a variant the question did not name is a different product', () => {
  const q = 'Harbor Band 8 vs Northwatch 2';
  const base = hit('Harbor Band 8 specs', 'The Harbor Band 8 has a 1.6 inch screen and a 14 day battery.', 'https://harbor.example/band-8');
  const pro = hit('Harbor Band 8 Pro review', 'The Harbor Band 8 Pro review: a brighter screen.', 'https://www.youtube.com/watch?v=abcdefghijk');
  const other = hit('Northwatch 2 specs', 'Northwatch 2 costs $90.', 'https://north.example/watch');
  const gated = gateResults(q, [pro, other, base]);
  assert.ok(gated.kept.some((row) => row.title === base.title));
  assert.equal(gated.kept.some((row) => row.title === pro.title), false);
  assert.equal(gateResults('Harbor Band 8', [pro, base]).kept.map((row) => row.title).join('|'), base.title);
  assert.equal(gateResults('Harbor Band 8 Pro', [pro, base]).kept.map((row) => row.title).join('|'), pro.title);
});

test('a price and a stat line are not model numbers', () => {
  const phones = hit('Best wireless headphones under $80', 'These wireless headphones stay under $80.', 'https://www.rtings.com/headphones/under-80');
  assert.deepEqual(gateResults('best wireless headphones under $100', [phones]).kept.map((r) => r.title), [phones.title]);
  const line = hit('Jaylen Brown dropped 30 on the Knicks', 'Brown scored 30 points.', 'https://www.espn.com/nba/story/brown-30');
  assert.equal(gateResults('jaylen brown injuries dropping', [line]).kept.length, 1);
});

test('Jayson Tatum preseason stats keeps the stat line instead of an empty result', () => {
  const q = 'Jayson Tatum Preseason Stats';
  assert.deepEqual(distinguishingTerms(q), []);
  const career = hit('Jayson Tatum', '2026-27 Projection Per 36 Minutes PTS 25.4', 'https://www.basketball-reference.com/players/t/tatumja01.html');
  const lineups = hit('Jayson Tatum 2025-26 Lineups', 'Regular Season 5-Man Combinations', 'https://www.basketball-reference.com/players/t/tatumja01/lineups/2026');
  const finals = hit('2022 NBA Finals', 'Jayson Tatum had a poor shooting performance, going 3-for-17', 'https://en.wikipedia.org/wiki/2022_NBA_Finals');
  const fox = hit('Jayson Tatum STATS | FOX Sports', '21.8 PPG 10.0 RPG 5.3 APG', 'https://www.foxsports.com/nba/jayson-tatum-player-stats?seasonType=pre');
  const real = hit('NBA Preseason Stats - RealGM', 'Jayson Tatum BOS 1 26.9 23.0 5.0 4.0', 'https://basketball.realgm.com/nba/preseason/stats');
  const nba = hit('Jayson Tatum | Forward-Guard | Boston Celtics', 'Tatum posted 23 points, five rebounds and four assists in the preseason win.', 'https://www.nba.com/player/1628369/jayson-tatum');
  assert.equal(hasFullPersonName('Jayson Tatum', fox), true);
  assert.equal(hasFullPersonName('Jayson Tatum', real), true);
  const onlyCareer = gateResults(q, [career, lineups, finals]);
  assert.deepEqual(onlyCareer.kept.map((r) => r.title), [career.title, lineups.title, finals.title]);
  const gated = gateResults(q, [career, lineups, finals, nba, real, fox]);
  assert.deepEqual(gated.kept.map((r) => r.title), [nba.title, real.title, fox.title, career.title, lineups.title, finals.title]);
});
