import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  entityContextLine,
  entityHintFor,
  isPersonAsk,
  matchesEntity,
  priorEntity,
  resolveEntity,
  contextTerms,
  hasFullPersonName,
  personSourceOk,
  personSubject,
  type Entity,
} from '../server/entity.ts';
import { gateResults } from '../server/relevanceGate.ts';
import { isBlockedHost } from '../server/spamHosts.ts';
import { isEventOrCategory, targetFor } from '../server/imageGate.ts';

const row = (title: string, snippet: string, url: string) => ({ title, url, snippet });

const RAY_LEE = [
  row(
    'Ray Lee - Software Engineer at Stripe | LinkedIn',
    'Ray Lee is a software engineer at Stripe in San Francisco.',
    'https://www.linkedin.com/in/ray-lee',
  ),
  row(
    'Stripe engineer Ray Lee on building APIs',
    'Stripe engineer Ray Lee joined Stripe in 2021 and works on payments APIs.',
    'https://techcrunch.com/2024/ray-lee-stripe',
  ),
  row(
    'Ray Lee (actor) - Wikipedia',
    'Ray Lee (born 1975) is an American actor known for independent films.',
    'https://en.wikipedia.org/wiki/Ray_Lee_(actor)',
  ),
  row(
    'Ray Lee - IMDb',
    'Ray Lee is an actor and producer known for Harbor Lights.',
    'https://www.imdb.com/name/nm1234567/',
  ),
  row(
    'Mayor Ray Lee of Springfield proposes budget',
    'Springfield mayor Ray Lee announced the city budget on Tuesday.',
    'https://www.springfieldnews.com/mayor-ray-lee-budget',
  ),
  row(
    'Ray Lee wins Springfield mayoral race',
    'Ray Lee won the Springfield mayoral race with 54 percent of the vote.',
    'https://www.springfieldnews.com/election-ray-lee',
  ),
];

describe('T444 entity disambiguation', () => {
  test('Ray Lee with three identities returns choices with distinct descriptors', () => {
    const d = resolveEntity('Ray Lee', RAY_LEE);
    assert.equal(d.kind, 'choices');
    assert.ok(d.choices.length >= 2);
    const descriptors = new Set(d.choices.map((c) => c.descriptor));
    assert.ok(descriptors.size >= 2, `descriptors should differ: ${[...descriptors]}`);
    for (const c of d.choices) {
      assert.ok(c.name.length > 0 && c.descriptor.length > 0 && c.query.length > 0 && c.id.length > 0);
      assert.ok(c.query.toLowerCase().includes('ray lee'), `choice query re-asks standalone: ${c.query}`);
    }
  });

  test('a thread entity locks the choice instead of asking again', () => {
    const stripe: Entity = {
      id: 'ray-lee-software-engineer-stripe',
      name: 'Ray Lee',
      role: 'Software Engineer',
      org: 'Stripe',
      terms: ['software', 'engineer', 'stripe'],
    };
    const d = resolveEntity('Ray Lee', RAY_LEE, { prior: stripe });
    assert.equal(d.kind, 'single');
    assert.equal(d.entity.org, 'Stripe');
    assert.deepEqual(d.kept, [0, 1]);
  });

  test('Who is John Smith with two identities returns choices', () => {
    const rows = [
      row(
        'John Smith, economist at Brookfield Institute',
        'John Smith is an economist at Brookfield Institute in Chicago.',
        'https://www.linkedin.com/in/john-smith-econ',
      ),
      row(
        'Brookfield economist John Smith on inflation',
        'Economist John Smith of Brookfield Institute discussed inflation.',
        'https://www.econnews.com/john-smith-inflation',
      ),
      row(
        'John Smith, chef in Portland',
        'John Smith is a chef in Portland, Oregon.',
        'https://www.portlandfood.com/john-smith-chef',
      ),
      row(
        'Chef John Smith opens Portland restaurant',
        'Chef John Smith opened a new restaurant in Portland.',
        'https://www.oregonlive.com/john-smith-restaurant',
      ),
    ];
    const d = resolveEntity('Who is John Smith', rows);
    assert.equal(d.kind, 'choices');
    assert.ok(d.choices.length >= 2);
  });

  test('Who is David Kim with three professions returns choices', () => {
    const rows = [
      row('David Kim, dentist in Austin', 'David Kim is a general dentist in Austin, Texas.', 'https://www.smiledental.com/david-kim'),
      row('David Kim DDS - Austin dental care', 'Dentist David Kim practices in Austin.', 'https://www.austindental.com/kim'),
      row('David Kim, concert pianist', 'David Kim is a concert pianist with the Philharmonic.', 'https://en.wikipedia.org/wiki/David_Kim_(pianist)'),
      row('Pianist David Kim performs Chopin', 'Concert pianist David Kim performed in Boston.', 'https://www.classicfm.com/david-kim-chopin'),
      row('David Kim - Software Engineer at Notion | LinkedIn', 'David Kim is a software engineer at Notion.', 'https://www.linkedin.com/in/david-kim-eng'),
      row('Notion engineer David Kim ships AI features', 'Software engineer David Kim works at Notion.', 'https://techcrunch.com/2025/david-kim-notion'),
    ];
    const d = resolveEntity('Who is David Kim', rows);
    assert.equal(d.kind, 'choices');
    assert.ok(d.choices.length >= 2);
    const joined = d.choices.map((c) => c.descriptor.toLowerCase()).join('\n');
    assert.ok(/dentist/.test(joined) && /pianist/.test(joined) && /engineer/.test(joined));
  });

  test('Who is Barack Obama with one unrelated hit is a single with the hit dropped', () => {
    const rows = [
      row('Barack Obama - Wikipedia', 'Barack Obama was the 44th president of the United States.', 'https://en.wikipedia.org/wiki/Barack_Obama'),
      row(
        'Barack Obama | The White House',
        'Barack Obama served as the 44th president of the United States. Official biography from the White House.',
        'https://www.whitehouse.gov/about-the-white-house/presidents/barack-obama/',
      ),
      row('Barack Obama | Biography', 'Barack Obama, former president and author, was born in Hawaii.', 'https://www.biography.com/barack-obama'),
      row(
        'Barack Obama Presidential Center',
        'The Barack Obama Presidential Center honors the former president.',
        'https://www.obama.org/presidential-center/',
      ),
      row('Bo, Obama family dog, dies at 12', 'Bo, the Obama family dog, died at age 12.', 'https://www.dognews.com/bo-obama-dog'),
    ];
    const d = resolveEntity('Who is Barack Obama', rows);
    assert.equal(d.kind, 'single');
    assert.equal(d.entity.name, 'Barack Obama');
    assert.deepEqual(d.kept, [0, 1, 2, 3]);
    assert.deepEqual(d.dropped, [4]);
    assert.ok((d.entity.domains ?? []).includes('whitehouse.gov'));
  });

  test('matchesEntity keeps the chosen identity and drops the others', () => {
    const stripe: Entity = {
      id: 'ray-lee-software-engineer-stripe',
      name: 'Ray Lee',
      role: 'Software Engineer',
      org: 'Stripe',
      terms: ['software', 'engineer', 'stripe', 'san', 'francisco'],
    };
    assert.equal(matchesEntity(stripe, RAY_LEE[0]!), true);
    assert.equal(matchesEntity(stripe, RAY_LEE[1]!), true);
    assert.equal(matchesEntity(stripe, RAY_LEE[2]!), false, 'the actor is a different person');
    assert.equal(matchesEntity(stripe, RAY_LEE[4]!), false, 'the mayor is a different person');
    assert.equal(
      matchesEntity(stripe, row("Ray Lee | LinkedIn", "View Ray Lee's professional profile.", 'https://www.linkedin.com/in/ray-lee-2')),
      true,
      'a name-only row absorbs',
    );
  });

  test('isPersonAsk fires for people and not for things', () => {
    assert.equal(isPersonAsk('Who is John Smith'), true);
    assert.equal(isPersonAsk('Who was Ray Lee'), true);
    assert.equal(isPersonAsk('Ray Lee'), true);
    assert.equal(isPersonAsk('Ray Lee', 'profile'), true);
    assert.equal(isPersonAsk('best wireless headphones'), false);
    assert.equal(isPersonAsk('what is photosynthesis'), false);
    assert.equal(isPersonAsk('best tablets', 'profile'), false);
    assert.equal(isPersonAsk('who is the fastest animal'), false);
  });

  test('entityHintFor names the person for person labels and stays silent otherwise', () => {
    const entity: Entity = {
      id: 'barack-obama-president',
      name: 'Barack Obama',
      role: 'President',
      org: 'White House',
      terms: ['president', 'white', 'house'],
      domains: ['whitehouse.gov', 'obama.org'],
      aliases: ['Barack Hussein Obama'],
    };
    const hintFor = entityHintFor(entity);
    const person = hintFor('Barack Obama');
    assert.ok(person, 'person label gets a hint');
    assert.equal(person!.name, 'Barack Obama');
    assert.deepEqual(person!.domains, ['whitehouse.gov', 'obama.org']);
    assert.equal(hintFor('Points'), undefined, 'a stat label gets no hint');
    assert.equal(hintFor('Games tonight'), undefined, 'an attribute label gets no hint');
    assert.ok(hintFor('White House'), 'the org label gets a hint');
  });

  test('t451: entityHintFor marks the hint strict only when the ask names the org', () => {
    const entity: Entity = { id: 'ray-lee-ceo-raycon', name: 'Ray Lee', role: 'CEO', org: 'Raycon', terms: ['ceo', 'raycon'] };
    assert.equal(entityHintFor(entity, 'Raycon CEO')('Ray Lee')!.strict, true);
    assert.equal(entityHintFor(entity, 'Who is Ray Lee')('Ray Lee')!.strict, undefined);
    assert.deepEqual(entityHintFor(entity, 'Who is Ray Lee')('Ray Lee')!.context, ['Raycon']);
  });

  test('the context line round-trips through the thread prior', () => {
    const entity: Entity = {
      id: 'ray-lee-software-engineer-stripe',
      name: 'Ray Lee',
      role: 'Software Engineer',
      org: 'Stripe',
      location: 'San Francisco',
      terms: ['software', 'engineer', 'stripe'],
    };
    const line = entityContextLine(entity);
    assert.ok(line.startsWith('Chosen person: Ray Lee'));
    const prior = priorEntity(`Topic: Ray Lee\n${line}\nEarlier turns…`);
    assert.ok(prior);
    assert.equal(prior!.name, 'Ray Lee');
    assert.equal(prior!.role, 'Software Engineer');
    assert.equal(prior!.org, 'Stripe');
    assert.equal(prior!.location, 'San Francisco');
    assert.equal(priorEntity('no chosen line here'), undefined);
  });
});


const GATE_RAY_LEE_BLUEFLAME = [
  { title: 'You are here', url: 'https://multporn.net/characters/ray_ray_lee', snippet: '' },
  { title: 'Lee A Ray & Associates in 309 Cedar Street', url: 'http://thedford-ne.thedealpages.com/lee-ray-associates/', snippet: '' },
  {
    title: 'Industry Innovators Launch BlueFlame AI',
    url: 'https://ffnews.com/newsarticle/fintech/industry-innovators-launch-blueflame-ai-to-help-alternative-i',
    snippet: 'BlueFlame was built by a team of industry innovators and GRC experts who have been at the forefront of the most signific',
  },
  {
    title: 'The End of Oak Street',
    url: 'https://en.wikipedia.org/wiki/The_End_of_Oak_Street',
    snippet: 'Blu- ray , and Ultra HD Blu- ray release follows on November 3, 2026. The film\'s marketing campaign was criticized on so',
  },
  {
    title: 'Ray Lee, founder of BlueFlame AI',
    url: 'https://blueflame.ai/team/ray-lee',
    snippet: 'Ray Lee founded BlueFlame AI to help alternative investment firms with GRC.',
  },
];

test('personSubject splits Ray Lee from BlueFlame AI context', () => {
  assert.equal(personSubject('Ray Lee BlueFlame AI'), 'Ray Lee');
  assert.deepEqual(contextTerms('Ray Lee BlueFlame AI').sort(), ['ai', 'blueflame']);
});

test('GATE-2cce9c0 rows: adult/Lee A Ray/Blu-ray fail; real BlueFlame page kept', () => {
  const q = 'Ray Lee BlueFlame AI';
  assert.equal(isBlockedHost(GATE_RAY_LEE_BLUEFLAME[0].url), true);
  assert.equal(hasFullPersonName('Ray Lee', GATE_RAY_LEE_BLUEFLAME[1]), false);
  assert.equal(hasFullPersonName('Ray Lee', GATE_RAY_LEE_BLUEFLAME[3]), false);
  assert.equal(personSourceOk(q, GATE_RAY_LEE_BLUEFLAME[2]), false);
  assert.equal(personSourceOk(q, GATE_RAY_LEE_BLUEFLAME[4]), true);
  const gated = gateResults(q, GATE_RAY_LEE_BLUEFLAME);
  assert.deepEqual(gated.kept.map((r) => r.title), ['Ray Lee, founder of BlueFlame AI']);
  const decision = resolveEntity(q, GATE_RAY_LEE_BLUEFLAME);
  assert.equal(decision.kind, 'single');
  if (decision.kind === 'single') assert.match(decision.entity.name, /Ray Lee/i);
});

test('Who is Ray Lee still returns choices for distinct people', () => {
  const d = resolveEntity('Who is Ray Lee', RAY_LEE);
  assert.equal(d.kind, 'choices');
  assert.ok(d.choices.length >= 2);
});

test('China Games event tile never gets a photo target', () => {
  assert.equal(isEventOrCategory('China Games'), true);
  assert.equal(targetFor('China Games').kind, 'none');
  assert.equal(targetFor('Preseason window').kind, 'none');
  assert.equal(targetFor('Role').kind, 'none');
});

test('SPD3: product comparisons are never a person ask (live P06 got Kindle choices)', () => {
  assert.equal(isPersonAsk('Kindle Paperwhite vs Kobo Clara BW for reading, which should I buy and what do they cost?'), false);
  assert.equal(isPersonAsk('iPad Air vs iPad Pro for drawing, which one and how much?', 'profile'), false);
  assert.equal(isPersonAsk('Who is Jensen Huang'), true);
});

test('SPD-C1: a capitalised topic inside a longer question is not a person ask', () => {
  assert.equal(isPersonAsk('Fact-check: Gmail lets you attach files up to 50 MB'), false);
  assert.equal(isPersonAsk('Fact-check: Henry Ford said "If I had asked people what they wanted, they would have said faster horses."'), false);
  assert.equal(isPersonAsk('Fact-check: PostgreSQL MERGE has supported RETURNING since version 15'), false);
  assert.equal(isPersonAsk('Does AirPods Pro 3 have a heart rate sensor?'), false);
  assert.equal(isPersonAsk('Recommend 3 books on the history of the printing press, with author and publication year'), false);
  assert.equal(isPersonAsk('Ray Lee BlueFlame AI'), true);
  assert.equal(isPersonAsk('Taylor Swift latest album'), true);
  assert.equal(isPersonAsk('Barack Obama'), true);
  assert.equal(isPersonAsk('Who is Jensen Huang'), true);
});
