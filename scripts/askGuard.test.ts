import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchoredFollowup, asksToCompare, cardFollowQuery, cryptographyHint, faithfulQuery, followSearchQuery, foreignName, isWritingAsk, lockChainQuery, needsOwnSearch, ownQuestion, personQuestion, pointsAtCard, quoteFollowQuery, sameSubjectQuery, screenSubject, scrubLeak, standsAlone, stripForeignNames, withoutLeakActions, withoutRepeatedCallouts } from '../server/askGuard.ts';
import { isPersonAsk } from '../server/entity.ts';
import { planLayout } from '../server/plan.ts';
import type { CardNode } from '../shared/card.ts';
import { followupLabel, visibleSpelling } from '../shared/followupLabel.ts';

test('a which-one follow-up stays on the comparison already on screen', () => {
  assert.equal(anchoredFollowup('iphone 17 vs pixel 10', 'which one has better battery life?'), 'iphone 17 vs pixel 10 battery life');
  assert.equal(anchoredFollowup('how do mRNA vaccines work', 'explain it like I am 10'), undefined);
  assert.equal(anchoredFollowup('iphone 17 vs pixel 10', 'Does the iPhone 17 come with 256GB storage as standard?'), undefined);
});

test('a writing request is answered, not searched, and a complete question is not rewritten', () => {
  assert.equal(isWritingAsk('Draft the unblock email'), true);
  assert.equal(isWritingAsk('write a short apology email for missing a meeting'), true);
  assert.equal(isWritingAsk('how do mRNA vaccines work'), false);
  assert.equal(standsAlone('How to use the IACR API'), true);
  assert.equal(standsAlone('explain it like I am 10'), false);
  assert.equal(asksToCompare('AJ Dybantsa vs 2026 NBA rookies vs past draft classes'), true);
  assert.equal(asksToCompare('compare this with that'), false);
});

test('a rewrite that drops the question, or picks up a banned address, is thrown out', () => {
  assert.equal(faithfulQuery('Draft the unblock email', 'Takes Two, 2a06:98c0:3600::103'), 'Draft the unblock email');
  assert.equal(faithfulQuery('Draft the unblock email', 'Takes Two proofs of work'), 'Draft the unblock email');
  assert.equal(faithfulQuery('explain it like I am 10', 'mRNA vaccines explained for a child'), 'mRNA vaccines explained for a child');
  assert.equal(faithfulQuery('apple varieties', 'best apple varieties for apple pie'), 'best apple varieties for apple pie');
  assert.equal(
    faithfulQuery('AJ Dybantsa preseason highlights', 'AJ Dybantsa Wizards washington stats'),
    'AJ Dybantsa preseason highlights',
  );
});

test('ban notices and addresses are scrubbed, and the chip that offers them never shows', () => {
  const dirty = 'Paper: It Takes Two.\nYour IP address of 2a06:98c0:3600::103 has been blocked for automated fetches in violation of robots.txt.';
  assert.equal(scrubLeak(dirty).includes('2a06'), false);
  assert.equal(scrubLeak(dirty).includes('It Takes Two'), true);
  const actions: Extract<CardNode, { type: 'actions' }> = {
    type: 'actions',
    items: [
      { label: 'Draft the unblock email', query: 'Draft an email to eprint-abuse about the blocked IP' },
      { label: 'Find the paper on arXiv', query: 'It Takes Two proofs of work arXiv' },
    ],
  };
  assert.deepEqual(withoutLeakActions(actions)?.items.map((i) => i.label), ['Find the paper on arXiv']);
});

test('a person follow-up is its own search, and a pronoun or a writing request is not', () => {
  assert.equal(personQuestion('What is Priya Natarajan?'), 'Priya Natarajan');
  assert.equal(personQuestion('Who is Sergio de Larrea?'), 'Sergio de Larrea');
  assert.equal(personQuestion('What is BlueFlame AI?'), 'What is BlueFlame AI?');
  assert.equal(personQuestion("What is Priya Natarajan's college?"), "What is Priya Natarajan's college?");
  assert.equal(needsOwnSearch('What is Priya Natarajan?', 'NBA scores tonight'), true);
  assert.equal(needsOwnSearch("What is Priya Natarajan's college?", 'NBA scores tonight'), true);
  assert.equal(needsOwnSearch('What is photosynthesis?', 'how do mRNA vaccines work'), false);
  assert.equal(needsOwnSearch('Who is Priya Natarajan?', 'Priya Natarajan'), false);
  assert.equal(needsOwnSearch('explain it like I am 10', 'how do mRNA vaccines work'), false);
  assert.equal(needsOwnSearch('which one has better battery life?', 'iphone 17 vs pixel 10'), false);
  assert.equal(needsOwnSearch('Draft the unblock email', 'It Takes Two'), false);
});

test('a person follow-up is a search when the planner is unavailable', async () => {
  const person = await planLayout('What is Priya Natarajan?', {} as never, { original: 'NBA scores tonight' });
  assert.equal(person.mode, 'search');
  assert.equal(person.pattern, 'profile');
  const chat = await planLayout('explain it like I am 10', {} as never, { original: 'how do mRNA vaccines work' });
  assert.equal(chat.mode, 'chat');
  const next = await planLayout('What is photosynthesis?', {} as never, { original: 'how do mRNA vaccines work' });
  assert.equal(next.mode, 'search');
});

test('an unrelated follow-up is its own question, and a related one keeps the subject', () => {
  assert.equal(ownQuestion('What is photosynthesis?', 'how do mRNA vaccines work'), true);
  assert.equal(ownQuestion('how many lakes are in Minnesota', 'who is Michael Jordan'), true);
  assert.equal(ownQuestion('tesla stock price', 'how to make sourdough starter'), true);
  assert.equal(ownQuestion('explain it like I am 10', 'how do mRNA vaccines work'), false);
  assert.equal(ownQuestion('which one has better battery life?', 'iphone 17 vs pixel 10'), false);
  assert.equal(ownQuestion('which is lightest for travel?', 'best budget noise cancelling headphones'), false);
  assert.equal(ownQuestion('who scored the most?', 'NBA scores tonight'), false);
  assert.equal(ownQuestion('what about Joe Lacob', 'who is Ed Chu'), false);
  assert.equal(ownQuestion('can I use rye flour instead?', 'how to make sourdough starter'), false);
  assert.equal(ownQuestion('How long does apple pie keep?', 'apple pie recipe'), false);
  assert.equal(ownQuestion("what's the price", 'Tesla stock'), false);
  assert.equal(ownQuestion('why is it moving today?', 'Btc Usd'), false);
  assert.equal(ownQuestion('Not this', 'who is Ed Chu'), false);
  assert.equal(ownQuestion('Draft the unblock email', 'It Takes Two'), false);
});

test('a later turn keeps the subject on screen unless it names a different one', () => {
  const covered = 'When did North Pier open?\nNorth Pier\nNorth Pier opened to visitors after a long build.';
  assert.equal(screenSubject('North Pier opened to visitors after a long build along the water', 'When did the new waterfront pier welcome its first visitors last decade?'), 'North Pier');
  assert.match(sameSubjectQuery('what is the viewing platform', 'North Pier', covered) ?? '', /^North Pier what is the viewing platform$/);
  assert.match(sameSubjectQuery('how many floors are open', 'North Pier', covered) ?? '', /North Pier/);
  assert.equal(sameSubjectQuery('What is photosynthesis?', 'how do mRNA vaccines work', 'how do mRNA vaccines work'), undefined);
  assert.equal(sameSubjectQuery('tesla stock price', 'how to make sourdough starter', 'how to make sourdough starter'), undefined);
  assert.equal(sameSubjectQuery('how many lakes are in Minnesota', 'who is Michael Jordan', 'who is Michael Jordan'), undefined);
  assert.match(sameSubjectQuery('how do solar panels work', 'Sourdough', 'how to make sourdough starter') ?? '', /^Sourdough /);
  assert.match(sameSubjectQuery('is there a gift shop', 'North Pier', covered) ?? '', /^North Pier /);
  assert.equal(foreignName('West Market viewing platform', 'North Pier viewing platform'), true);
  assert.equal(stripForeignNames('West Market Cedar Park viewing platform', 'North Pier viewing platform'), 'viewing platform');
  assert.equal(
    lockChainQuery('what is the viewing platform', 'West Market Cedar Park viewing platform', 'North Pier', covered),
    'North Pier viewing platform',
  );
  assert.equal(
    lockChainQuery('how many lakes are in Minnesota', 'how many lakes are in Minnesota', 'Michael Jordan', 'who is Michael Jordan'),
    'how many lakes are in Minnesota',
  );
  assert.equal(screenSubject('How tall is it?', 'When did the Gateway Arch open to visitors?'), 'Gateway Arch');
  assert.equal(
    lockChainQuery('What is the tram ride to the top like?', 'Gateway Arch Open What is the tram ride to the top like?', 'Gateway Arch', 'When did the Gateway Arch open to visitors?'),
    'Gateway Arch What is the tram ride to the top like?',
  );
});

test('a follow-up that points at the card keeps that subject, and an unrelated one stays its own question', () => {
  const card = 'Moderna\nShares fell 9.2% in morning trading, hitting a session low of $214.30 after the trial update.';
  const explain = 'Explain "Shares fell 9.2% in morning trading, hitting a session low of $214.30"';
  assert.equal(pointsAtCard(explain, card), true);
  assert.equal(ownQuestion(explain, 'Moderna'), true);
  assert.match(cardFollowQuery(explain, 'Moderna', card) ?? '', /^Moderna Shares fell 9\.2%/);
  assert.equal(pointsAtCard('explain this move', 'Moderna'), true);
  assert.equal(cardFollowQuery('explain this move', 'Moderna', 'Moderna'), 'Moderna this move');
  assert.equal(pointsAtCard('of those, which are cheaper', card), false);
  assert.equal(cardFollowQuery('What is photosynthesis?', 'Moderna', card), undefined);
  assert.equal(ownQuestion('What is photosynthesis?', card), true);
  assert.equal(pointsAtCard('Draft the unblock email', card), false);
});

test('explaining a sentence on the card searches that subject, not a company named Explain', () => {
  const sentence = 'Shares fell 9.2% in morning trading, hitting a session low of $214.30 after the opening auction.';
  const card = `Moderna\n${sentence}`;
  const cleaned = `Explain ${sentence}`;
  const quoted = `Explain "${sentence}"`;
  const subjects = ['Moderna'];
  assert.match(followSearchQuery(cleaned, 'Moderna', card, subjects) ?? '', /^Moderna Shares fell 9\.2%/);
  assert.match(followSearchQuery(quoted, 'Moderna', card, subjects) ?? '', /^Moderna Shares fell 9\.2%/);
  assert.equal(followSearchQuery('explain this move', 'Moderna', 'Moderna', subjects), 'Moderna this move');
  assert.equal(followSearchQuery('What is photosynthesis?', 'Moderna', card, subjects), undefined);
  assert.equal(followSearchQuery("what's its price", 'Tesla', 'Tesla stock', ['Tesla', 'tesla stock']), "tesla stock what's its price");
});

test('a price follow-up names the instrument already on screen', () => {
  assert.equal(quoteFollowQuery('AAPL stock', ['how to make sourdough starter']), 'AAPL stock');
  assert.equal(quoteFollowQuery("what's the price", ['Tesla', 'tesla stock']), 'tesla stock what\'s the price');
  assert.equal(quoteFollowQuery('why is it moving today?', ['Btc Usd']), undefined);
  assert.equal(quoteFollowQuery('how much does the battery weigh', ['iphone 17']), undefined);
  const long = 'AI Data Center Debt vs 2008 MBS Based on 2008 scenario and outcome, how the stock and companies will play out and who gets hurt when the debt comes due';
  assert.ok(long.length > 120);
  assert.equal(quoteFollowQuery(long, ['AI Data Center Debt vs 2008 MBS']), undefined);
  assert.equal(long.slice(0, 120).endsWith(' '), false);
});

test('a query carrying an address is never a person to disambiguate', () => {
  assert.equal(isPersonAsk('Takes Two, 2a06:98c0:3600::103'), false);
  assert.equal(isPersonAsk('Who is Jessica Chen'), true);
});

test('a region keeps its list when only its warning repeats one already shown', () => {
  const shown: CardNode[] = [{ type: 'callout', tone: 'warning', title: 'No recent news', text: 'No dated news about Jessica Chen at NYU and cryptocurrency was found.' }];
  const region: CardNode = {
    type: 'section',
    children: [
      { type: 'callout', tone: 'warning', title: 'No recent news', text: 'No dated news about Jessica Chen at NYU and cryptocurrency.' },
      { type: 'list', items: [{ text: 'The paper credits Jessica Chen at NYU' }] },
    ],
  };
  const kept = withoutRepeatedCallouts(region, shown);
  assert.equal(kept?.type, 'section');
  assert.deepEqual(kept && 'children' in kept ? kept.children.map((c) => c.type) : [], ['list']);
});

test('"crypto" beside cryptography papers means the field', () => {
  const rows = [{ title: 'Proofs of Work for Fiat–Shamir', snippet: 'cryptography, New York University', url: 'https://eprint.iacr.org/2026/2326' }];
  assert.match(cryptographyHint('latest on Jessica Chen nyu crypto', rows) ?? '', /cryptography/);
  assert.equal(cryptographyHint('bitcoin price today', rows), undefined);
});

test('a follow-up label stays the words that were typed', () => {
  assert.equal(followupLabel('what does this company make', 'Moderna Stock Price what does this company make'), 'what does this company make');
  assert.equal(followupLabel('What is photosynthesis?', 'What is photosynthesis?'), 'What is photosynthesis?');
  assert.equal(followupLabel('Ricky cheuk', 'Ricky Gervais Ricky Cheuk'), 'Ricky cheuk');
  assert.equal(followupLabel('Ricky Gervais Ricky Cheuk', 'Ricky Cheuk'), 'Ricky Cheuk');
  assert.equal(visibleSpelling('Glowband 4 vs Northwatch 2', 'Glowband 4 vs Glayband 2'), undefined);
  assert.equal(visibleSpelling('Glowband 4 vs Northwatch 2', 'Glow Band 4 vs Northwatch 2'), 'Glow Band 4 vs Northwatch 2');
  assert.equal(visibleSpelling('Jensen Huang Nvdia', 'Jensen Huang, NVIDIA'), 'Jensen Huang, NVIDIA');
});
