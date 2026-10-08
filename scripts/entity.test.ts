import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import {
  entityContextLine,
  entityHintFor,
  isPersonAsk,
  matchesEntity,
  priorEntity,
  resolveEntity,
  disambiguationEntries,
  contextTerms,
  distinguishingTerms,
  cleanCapture,
  hasFullPersonName,
  isDisambiguationPage,
  personSourceOk,
  personSubject,
  knowledgeForKept,
  knowledgeRow,
  type Entity,
  type EntityRow,
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

  test('EN3: a picked-choice ask makes the person hint require its org/descriptor', () => {
    const c2: Entity = { id: 'david-kim-founder-c2', name: 'David Kim', role: 'Founder', org: 'C2', terms: ['founder', 'c2'] };
    const h = entityHintFor(c2, 'David Kim C2 Founder')('David Kim')!;
    assert.equal(h.requireContext, true);
    assert.ok(h.context!.includes('C2'));
    assert.ok(!h.context!.includes('founder'), 'role word is not enough when an org exists');
    const actor: Entity = { id: 'david-kim-actor', name: 'David Kim', role: 'Actor', terms: ['actor'] };
    assert.deepEqual(entityHintFor(actor, 'David Kim Actor')('David Kim')!.context, ['actor']);
    assert.equal(entityHintFor(c2, 'Who is David Kim')('David Kim')!.requireContext, undefined);
    assert.equal(entityHintFor(c2, 'David Kim')('David Kim')!.requireContext, undefined);
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

test('Wikipedia disambiguation page seeds choices (live: Who is Ray Lee / David Kim)', () => {
  const rows = [
    row(
      'Ray Lee (disambiguation) - Wikipedia',
      'Ray Lee may refer to: Ray Lee (coach), American track coach at USATF; Ray Lee (CEO), CEO of Max Robotics; Ray Lee (actor).',
      'https://en.wikipedia.org/wiki/Ray_Lee_(disambiguation)',
    ),
    row('Other news', 'Unrelated.', 'https://example.com/x'),
  ];
  const d = resolveEntity('Who is Ray Lee', rows);
  assert.equal(d.kind, 'choices');
  if (d.kind !== 'choices') return;
  assert.ok(d.choices.length >= 2);
  for (const c of d.choices) {
    assert.ok(c.descriptor.length <= 40, c.descriptor);
    assert.doesNotMatch(c.descriptor, /Coach at USATF CEO/i);
    assert.match(c.query, /^Ray Lee /);
    assert.doesNotMatch(c.query, /\bat\b|\bof\b/);
  }
});

test('choice descriptors stay short and natural; query is searchable', () => {
  const d = resolveEntity('Who is Ray Lee', RAY_LEE);
  assert.equal(d.kind, 'choices');
  if (d.kind !== 'choices') return;
  for (const c of d.choices) {
    assert.ok(c.descriptor.length <= 40, c.descriptor);
    assert.match(c.descriptor, /^(Software Engineer at Stripe|Actor|Mayor of Springfield|Wikipedia article|IMDb page|.+)$/);
    assert.ok(c.query.startsWith('Ray Lee'));
    // Follow-up must not be the mashed "Name (descriptor)" form when query is set.
    assert.ok(!c.query.includes('('));
  }
  const eng = d.choices.find((c) => /stripe/i.test(c.descriptor));
  assert.ok(eng);
  assert.match(eng!.query, /Stripe/i);
});

test('picked-choice follow-up never falls back to name-only pages', () => {
  const rows = [
    row('Ray Lee - USATF coach profile', 'Ray Lee is a coach with USATF in California.', 'https://www.usatf.org/ray-lee'),
    row('Ray Lee LinkedIn', 'Ray Lee works in tech.', 'https://www.linkedin.com/in/ray-lee'),
    row('Unrelated headphones', 'Best noise cancelling under 200.', 'https://example.com/headphones'),
  ];
  // Strict context (USATF) would drop the LinkedIn row; without USATF on LinkedIn we'd keep coach only.
  const gated = gateResults('Ray Lee USATF coach', rows);
  assert.ok(gated.kept.length >= 1);
  assert.ok(gated.kept.some((r) => /usatf/i.test(r.url)));
  // When NO row has the context token the gate keeps nothing (stream.ts then retries / re-offers choices).
  const loose = [
    row('Ray Lee - coach bio', 'Ray Lee has coached track for twenty years.', 'https://www.example.com/ray-lee-coach'),
    row('Ray Lee actor', 'Ray Lee is an actor.', 'https://en.wikipedia.org/wiki/Ray_Lee_(actor)'),
  ];
  const fallback = gateResults('Ray Lee USATF coach', loose);
  assert.equal(fallback.kept.length, 0, 'never wrong > none: namesake name-only pages are not a fallback');
});

test('prior entity with no matching cluster falls back to name hits (not empty)', () => {
  const prior: Entity = {
    id: 'ray-lee-coach-usatf',
    name: 'Ray Lee',
    role: 'Coach',
    org: 'USATF',
    terms: ['coach', 'usatf'],
  };
  const rows = [
    row('Ray Lee - personal site', 'Ray Lee writes about running.', 'https://raylee.example.com/'),
    row('Someone else', 'Totally different.', 'https://example.com/other'),
  ];
  const d = resolveEntity('Ray Lee USATF coach', rows, { prior });
  assert.equal(d.kind, 'single');
  if (d.kind === 'single') {
    assert.deepEqual(d.kept, [0]);
    assert.equal(d.entity.name, 'Ray Lee');
  }
});

test('spam *.web.app random subdomains are blocked; named hosts are not', () => {
  assert.equal(isBlockedHost('https://newlibraryjgza.web.app/page'), true);
  assert.equal(isBlockedHost('https://x7k9m2qp1ab.web.app/'), true);
  assert.equal(isBlockedHost('https://docs.web.app/guide'), false);
  assert.equal(isBlockedHost('https://my-app.web.app/'), false);
});

describe('entity3 clean choice labels (GATE-c234daf)', () => {
  const ray = [
    { title: 'Ray Lee - Co-founder & CEO at Raycon', url: 'https://www.linkedin.com/in/rayleeny', snippet: 'Co-founder & CEO at Raycon Inc. New York' },
    { title: 'Ray Lee', url: 'https://filmfreeway.com/RayLeeProducer', snippet: 'Ray Lee, an Associate Professor and film director based in Kuala Lumpur' },
    { title: 'Ray Lee/4.0 - NoPixel Wiki - Fandom', url: 'https://nopixel.fandom.com/wiki/Ray_Lee/4.0', snippet: 'Ray Lee is a Deputy State Marshal for the San Andreas State Marshals' },
    { title: 'Ray Lee', url: 'https://en.wikipedia.org/wiki/Ray_Lee', snippet: 'Raymond Maurice Lee is an English former footballer who played as a right winger for Arsenal.' },
  ];
  test('location takes "in", org takes "of"/"at", bare org is "Linked to", fandom never seeds', () => {
    const d = resolveEntity('Who is Ray Lee', ray, { pattern: 'profile' });
    assert.equal(d.kind, 'choices');
    const labels = d.kind === 'choices' ? d.choices.map((c) => c.descriptor) : [];
    assert.ok(labels.includes('CEO of Raycon'), labels.join(' | '));
    assert.ok(labels.includes('Director in Kuala Lumpur'), labels.join(' | '));
    assert.ok(labels.includes('Linked to Arsenal'), labels.join(' | '));
    for (const l of labels) {
      assert.ok(l.length <= 40, l);
      assert.ok(!/San Andreas/i.test(l), l);
      assert.ok(!/\bof (Kuala Lumpur|Los Angeles)\b/.test(l), l);
      assert.ok(!/\bU\.S$/.test(l), l);
      assert.ok(!/\b(CEO|Coach|Founder|Player)\b.*\b(CEO|Coach|Founder|Player)\b/.test(l), `mashed: ${l}`);
    }
  });
  test('a clipped "U.S" is dropped, never shown; trailing clause after ". " is cut', () => {
    const d = resolveEntity('Who is David Kim', [
      { title: 'David Kim', url: 'https://www.stimson.org/ppl/david-kim/', snippet: 'David Y. Kim is an analyst with the Stimson Center. He formerly worked as a political appointee at the U.S. ...' },
      { title: 'David Kim', url: 'https://www.imdb.com/name/nm4148095/', snippet: 'David Kim. Actor: Bleeding Iowa. David Sung-Joon Kim grew up in Los Angeles training in martial arts.' },
    ], { pattern: 'profile' });
    const labels = d.kind === 'choices' ? d.choices.map((c) => c.descriptor) : [];
    for (const l of labels) assert.ok(!/U\.S$/.test(l) && !/\.\s\w/.test(l), l);
  });
  test('Wikipedia disambiguation gloss gives the clean role', () => {
    const row = { title: 'David Kim', url: 'https://en.wikipedia.org/wiki/David_Kim', snippet: 'David Kim may refer to: David Kim (violinist), American violinist; David Kim (restaurateur), American businessman and CEO of Baja Fresh.' };
    const labels = disambiguationEntries(row, 'David Kim').map((e) => e.label);
    assert.deepEqual(labels.slice(0, 2), ['Violinist', 'Restaurateur']);
  });
});

/** Recorded LangSearch (ls-*) + Serper (serper-*) SERPs, replayed exactly like scripts/en4-replay.mjs. */
interface SerpFixture { query: string; rows: EntityRow[] }
const SERPS: Record<string, SerpFixture> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/en4/serps.json', import.meta.url), 'utf8'),
);
const run = (key: string) => {
  const fx = SERPS[key];
  assert.ok(fx, `missing fixture ${key}`);
  return resolveEntity(fx.query, fx.rows, { pattern: 'profile' });
};
const descriptorsOf = (key: string) => {
  const d = run(key);
  return d.kind === 'choices' ? d.choices.map((c) => c.descriptor) : [];
};

describe('EN4 recorded SERPs (scripts/fixtures/en4/serps.json)', () => {
  test('a famous name with a dominant Wikipedia identity is a single, never choices', () => {
    for (const key of ['ls-obama', 'serper-obama', 'ls-swift']) {
      assert.equal(run(key).kind, 'single', key);
    }
  });

  test('every choice descriptor is short, factual and never a pronoun tail', () => {
    for (const [key, fx] of Object.entries(SERPS)) {
      const d = resolveEntity(fx.query, fx.rows, { pattern: 'profile' });
      if (d.kind !== 'choices') continue;
      assert.ok(d.choices.length <= 3, `${key}: ${d.choices.length} choices`);
      for (const c of d.choices) {
        assert.ok(c.descriptor.length > 0, `${key}: empty descriptor`);
        assert.ok(c.descriptor.length <= 40, `${key}: ${c.descriptor}`);
        assert.doesNotMatch(
          c.descriptor,
          /\.\s|wiki|^Linked to (It|May|He|She)$|\b(It|He|She|May)$/i,
          `${key}: ${c.descriptor}`,
        );
      }
    }
  });

  test('ls-js: no site chrome, no Wiktionary, no regnal org as a descriptor', () => {
    const labels = descriptorsOf('ls-js');
    assert.ok(labels.length >= 2, labels.join(' | '));
    for (const l of labels) {
      assert.notEqual(l, 'Wikipedia article', l);
      assert.ok(!l.includes('Wiktionary'), l);
      assert.ok(!l.startsWith('Linked to George') && !l.startsWith('Linked to Charles'), l);
    }
  });

  test('ls-dk is choices with a C2 choice', () => {
    const d = run('ls-dk');
    assert.equal(d.kind, 'choices');
    assert.ok(descriptorsOf('ls-dk').some((l) => l.includes('C2')), descriptorsOf('ls-dk').join(' | '));
  });

  test('serper-ray offers the Raycon founder and the Arsenal footballer', () => {
    const labels = descriptorsOf('serper-ray');
    assert.ok(labels.includes('Founder of Raycon'), labels.join(' | '));
    assert.ok(labels.includes('Linked to Arsenal'), labels.join(' | '));
  });

  test('serper-dk keeps C2 Education; serper-bf and serper-dkpick resolve to one person', () => {
    assert.ok(descriptorsOf('serper-dk').some((l) => l.includes('C2 Education')), descriptorsOf('serper-dk').join(' | '));
    assert.equal(run('serper-bf').kind, 'single');
    assert.equal(run('serper-dkpick').kind, 'single');
  });

  test('personSourceOk wants the named org, not a namesake church or a teacher', () => {
    assert.equal(
      personSourceOk('Ray Lee Raycon Founder', {
        title: 'Ray Lee obituary',
        url: 'https://funeralhome.example/ray-lee',
        snippet: 'Ray Lee, founder of a local church, passed away',
      }),
      false,
    );
    assert.equal(
      personSourceOk('Ray Lee Raycon Founder', {
        title: 'Ray Lee obituary',
        url: 'https://funeralhome.example/ray-lee',
        snippet: 'Ray Lee, co-founder of Raycon, passed away',
      }),
      true,
    );
    assert.equal(
      personSourceOk('David Kim C2 Education Centers Founder', {
        title: 'David Kim',
        url: 'https://uca.edu/x',
        snippet: 'David Kim teaches education at UCA',
      }),
      false,
    );
  });

  test('distinguishingTerms keeps only the org core of "C2 Education Centers"', () => {
    assert.deepEqual(distinguishingTerms('David Kim C2 Education Centers Founder'), ['c2']);
  });

  test('a run-on snippet never leaks "China. He" into a descriptor', () => {
    const d = resolveEntity(
      'Who is Ray Lee',
      [
        { title: 'Ray Lee', url: 'https://a.example/1', snippet: 'Ray Lee is a writer based in China. He wrote novels.' },
        { title: 'Ray Lee - CEO at Raycon', url: 'https://linkedin.com/in/x', snippet: 'Ray Lee, CEO at Raycon Inc.' },
      ],
      { pattern: 'profile' },
    );
    const labels = d.kind === 'choices' ? d.choices.map((c) => c.descriptor) : [];
    assert.ok(labels.length >= 2, labels.join(' | '));
    for (const l of labels) {
      assert.ok(!l.includes('China. He'), l);
      assert.ok(!l.endsWith(' He'), l);
    }
  });
});

/** Recorded live LangSearch SERPs for the EN4 part-5 fixes (scripts/fixtures/en4/live2.json). */
interface Live2Knowledge { title: string; extract: string; url: string; description?: string }
interface Live2Fixture { query: string; results: EntityRow[]; knowledge: Live2Knowledge | null }
const LIVE2: Record<string, Live2Fixture> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/en4/live2.json', import.meta.url), 'utf8'),
);
const live2 = (key: string) => {
  const fx = LIVE2[key];
  assert.ok(fx, `missing fixture ${key}`);
  return fx;
};
const urlsOf = (fx: Live2Fixture, kept: number[]) => kept.map((i) => fx.results[i]!.url);

describe('EN4 live LangSearch fixes (scripts/fixtures/en4/live2.json)', () => {
  test('a pick or descriptor ask never seeds choices from a disambiguation page', () => {
    const fx = live2('ls-dkpick');
    const disambig = fx.results[3]!;
    assert.ok(isDisambiguationPage(disambig), 'fixture row 3 is the "may refer to" page');
    const d = resolveEntity(fx.query, fx.results, { pattern: 'profile' });
    assert.equal(d.kind, 'single');
    if (d.kind !== 'single') return;
    assert.equal(d.entity.name, 'David Kim');
    const kept = urlsOf(fx, d.kept);
    assert.ok(kept.includes('https://en.wikipedia.org/wiki/David_J._Kim'), kept.join(' | '));
    assert.ok(
      kept.includes('https://www.forsythnews.com/local/state-government/political-newcomer-david-kim-running-district-7/'),
      kept.join(' | '),
    );
    assert.ok(kept.includes('https://keia.org/korean-american-day'), kept.join(' | '));
    // The disambiguation page names other people: never a source, never a choice.
    assert.ok(!kept.includes(disambig.url), kept.join(' | '));
    assert.ok(d.dropped.includes(3), d.dropped.join(','));
    // A picked choice queries the same ask with a thread prior: same rule.
    const picked = resolveEntity(fx.query, fx.results, {
      pattern: 'profile',
      prior: { id: 'david-kim-ceo-c2-education', name: 'David Kim', role: 'CEO', org: 'C2 Education', terms: ['c2', 'ceo'] },
    });
    assert.equal(picked.kind, 'single');
    if (picked.kind === 'single') assert.ok(!urlsOf(fx, picked.kept).includes(disambig.url));
  });

  test('a birth/death year phrase is never a choice descriptor', () => {
    const YEAR = /^(born|b\.|died|d\.)\s*(c\.\s*)?\d{3,4}$/i;
    const fx = live2('ls-dkpick');
    const entries = disambiguationEntries(fx.results[3]!, 'David Kim');
    const labels = entries.map((e) => e.label);
    assert.ok(labels.includes('Violinist'), labels.join(' | '));
    assert.ok(labels.includes('Restaurateur'), labels.join(' | '));
    for (const l of labels) {
      assert.doesNotMatch(l, YEAR, l);
      assert.doesNotMatch(l, /^\d{3,4}s?$/, l);
      assert.ok(l.length > 0, l);
    }
    // Bare ask: the page still seeds choices, minus the year entry.
    const d = resolveEntity('Who is David Kim', [fx.results[3]!], { pattern: 'profile' });
    assert.equal(d.kind, 'choices');
    if (d.kind !== 'choices') return;
    assert.ok(d.choices.length >= 2, d.choices.map((c) => c.descriptor).join(' | '));
    for (const c of d.choices) {
      assert.ok(c.descriptor.length > 0, c.descriptor);
      assert.doesNotMatch(c.descriptor, YEAR, c.descriptor);
      assert.doesNotMatch(c.descriptor, /^\d{3,4}s?$/, c.descriptor);
    }
    // An org/label capture that is only a year is dropped, not shown.
    assert.equal(cleanCapture('born 1979'), '');
    assert.equal(cleanCapture('1979'), '');
    assert.equal(cleanCapture('d. 1968'), '');
    assert.equal(cleanCapture('C2 Education'), 'C2 Education');
  });

  test('a one-token famous ask resolves to the Wikipedia person, not a skip', () => {
    const fx = live2('ls-obama-single-token');
    const d = resolveEntity(fx.query, fx.results, { pattern: 'profile' });
    assert.equal(d.kind, 'single');
    if (d.kind !== 'single') return;
    assert.equal(d.entity.name, 'Barack Obama');
    const kept = fx.results.filter((_, i) => d.kept.includes(i));
    assert.ok(kept.some((r) => r.url === 'https://en.wikipedia.org/wiki/Barack_Obama'), urlsOf(fx, d.kept).join(' | '));
    for (const r of kept) assert.match(`${r.title ?? ''} ${r.snippet ?? ''}`, /obama/i, r.url);
    // No Wikipedia person article for the token: today's behaviour (skip) stands.
    const nvidia = resolveEntity('Who is Nvidia', [
      { title: 'Nvidia', url: 'https://www.nvidia.com/en-us/', snippet: 'Nvidia pioneered accelerated computing.' },
      { title: 'GeForce - Wikipedia', url: 'https://en.wikipedia.org/wiki/GeForce', snippet: 'GeForce is a brand of graphics processing units.' },
      { title: 'Nvidia - Wikipedia', url: 'https://en.wikipedia.org/wiki/Nvidia', snippet: 'Nvidia Corporation is an American technology company.' },
    ], { pattern: 'profile' });
    assert.equal(nvidia.kind, 'skip');
  });

  test('the encyclopedia knowledge panel only rides with its own article', () => {
    const fx = live2('ls-ray-knowledge');
    assert.ok(fx.knowledge, 'fixture carries a knowledge panel');
    const panel = knowledgeRow(fx.knowledge!, fx.results);
    assert.ok(panel, 'the panel becomes a row');
    assert.equal(panel!.url, fx.knowledge!.url);
    assert.equal(panel!.title, fx.knowledge!.title);
    assert.equal(panel!.domain, 'en.wikipedia.org');
    assert.deepEqual(panel!.engines, ['wikipedia']);
    assert.equal(panel!.snippet, [fx.knowledge!.description, fx.knowledge!.extract].filter(Boolean).join(' — '));
    // No duplicate row, no panel for a non-Wikipedia url, nothing without a panel.
    assert.equal(knowledgeRow(fx.knowledge!, [panel!, ...fx.results]), null);
    assert.equal(knowledgeRow({ title: 'x', extract: 'y', url: 'https://www.gaana.com/artist/ray-lee' }, fx.results), null);
    assert.equal(knowledgeRow(null, fx.results), null);
    // Kept-row matching ignores host case and a trailing slash.
    assert.equal(knowledgeForKept(fx.knowledge, [panel!, ...fx.results]), true);
    assert.equal(knowledgeForKept(fx.knowledge, fx.results), false);
    assert.equal(knowledgeForKept(undefined, fx.results), false);
    assert.equal(
      knowledgeForKept({ url: 'https://EN.wikipedia.org/wiki/Ray_Lee/' }, [{ title: 'Ray Lee', url: 'https://en.wikipedia.org/wiki/Ray_Lee' }]),
      true,
    );

    // The SERP plus the panel row: the footballer and the singer never share one card.
    const rows = [panel!, ...fx.results];
    const d = resolveEntity(fx.query, rows, { pattern: 'profile' });
    const keptUrls = d.kind === 'single' ? rows.filter((_, i) => d.kept.includes(i)).map((r) => r.url) : [];
    assert.ok(
      !(d.kind === 'single' && keptUrls.includes(panel!.url) && keptUrls.includes('https://gaana.com/artist/ray-lee')),
      `mixed card: ${keptUrls.join(' | ')}`,
    );
    if (d.kind === 'single') {
      assert.ok(keptUrls.includes(panel!.url), keptUrls.join(' | '));
    } else {
      assert.equal(d.kind, 'choices');
      assert.ok(d.choices.length >= 2, d.choices.map((c) => c.descriptor).join(' | '));
      for (const c of d.choices) {
        assert.ok(c.descriptor.length > 0, c.descriptor);
        assert.ok(!/wikipedia|wiktionary/i.test(c.descriptor), c.descriptor);
      }
    }
  });
});

const wordsBeyond = (query: string, name: string) =>
  query.trim().split(/\s+/).filter(Boolean).length - name.trim().split(/\s+/).filter(Boolean).length;

describe('EN4 part 6: a pick must stay a person ask', () => {
  test('personSubject cuts the name at a role or descriptor word', () => {
    assert.equal(personSubject('John Smith Explorer'), 'John Smith');
    assert.equal(personSubject('Ray Lee Athlete'), 'Ray Lee');
    assert.equal(personSubject('Ray Lee Artist'), 'Ray Lee');
    assert.equal(personSubject('David Kim Violinist'), 'David Kim');
    assert.equal(personSubject('David Kim Restaurateur'), 'David Kim');
    assert.equal(personSubject('Ray Lee Housebreaker'), 'Ray Lee');
    // A three-token name with no org/role tail stays whole.
    assert.equal(personSubject('Barack Hussein Obama'), 'Barack Hussein Obama');
    assert.equal(personSubject('Who is Barack Hussein Obama'), 'Barack Hussein Obama');
    assert.equal(personSubject('Ray Lee BlueFlame AI'), 'Ray Lee');
    assert.equal(personSubject('Ray Lee Raycon Founder'), 'Ray Lee');
  });

  test('every recorded choice re-asks the named person within SPD-C1 (3 words)', () => {
    const ray = live2('ls-ray-knowledge');
    const panel = knowledgeRow(ray.knowledge, ray.results);
    assert.ok(panel, 'fixture carries a knowledge panel');
    const decisions: [string, ReturnType<typeof resolveEntity>][] = [
      ...['ls-dk', 'serper-dk', 'ls-js', 'serper-ray'].map((k) => [k, run(k)] as [string, ReturnType<typeof resolveEntity>]),
      ['ls-ray-knowledge', resolveEntity(ray.query, [panel!, ...ray.results], { pattern: 'profile' })],
    ];
    for (const [key, d] of decisions) {
      if (d.kind !== 'choices') continue;
      assert.ok(d.choices.length >= 1, `${key}: no choices`);
      for (const c of d.choices) {
        assert.equal(isPersonAsk(c.query), true, `${key}: ${c.query}`);
        assert.equal(personSubject(c.query), c.name, `${key}: ${c.query}`);
        assert.ok(wordsBeyond(c.query, c.name) <= 3, `${key}: ${c.query}`);
      }
    }
    // "C2 Education Centers" + "CEO" keeps the org core the pick gate needs.
    const dk = run('ls-dk');
    assert.equal(dk.kind, 'choices');
    if (dk.kind !== 'choices') return;
    const c2 = dk.choices.find((c) => /C2/.test(c.query));
    assert.ok(c2, dk.choices.map((c) => c.query).join(' | '));
    assert.equal(c2!.query, 'David Kim C2 Education CEO', c2!.query);
    assert.ok(distinguishingTerms(c2!.query).includes('c2'), c2!.query);
  });

  test('the C2 pick resolves to one person and never the "may refer to" page', () => {
    const fx = live2('ls-dkpick');
    const disambig = fx.results[3]!;
    assert.ok(isDisambiguationPage(disambig), 'fixture row 3 is the "may refer to" page');
    const d = resolveEntity('David Kim C2 Education CEO', fx.results, { pattern: 'profile' });
    assert.equal(d.kind, 'single');
    if (d.kind !== 'single') return;
    assert.equal(d.entity.name, 'David Kim');
    assert.ok(d.kept.includes(0) && d.kept.includes(1) && d.kept.includes(2), d.kept.join(','));
    assert.ok(!d.kept.includes(3), 'the disambiguation page lists other people');
    assert.ok(d.dropped.includes(3), d.dropped.join(','));
  });
});

describe('EN4 part 7: a choice re-asks its org/location, never the bare name', () => {
  test('the "Linked to Arsenal" choice re-asks "Ray Lee of Arsenal"', () => {
    for (const key of ['ls-ray', 'serper-ray1']) {
      const d = run(key);
      assert.equal(d.kind, 'choices', key);
      if (d.kind !== 'choices') continue;
      const c = d.choices.find((x) => x.descriptor === 'Linked to Arsenal');
      assert.ok(c, `${key}: ${d.choices.map((x) => x.descriptor).join(' | ')}`);
      assert.equal(c!.query, 'Ray Lee of Arsenal', c!.query);
      assert.equal(isPersonAsk(c!.query), true, c!.query);
      assert.equal(personSubject(c!.query), 'Ray Lee', c!.query);
      assert.ok(contextTerms(c!.query).includes('arsenal'), c!.query);
      assert.ok(wordsBeyond(c!.query, c!.name) <= 3, c!.query);
      // The connector is a stop word, never context: only the org word picks this person.
      for (const stop of ['of', 'in', 'at']) assert.ok(!contextTerms(c!.query).includes(stop), c!.query);
      // The pick now names the org, so it comes back as one person, not the same choices.
      assert.equal(resolveEntity(c!.query, SERPS[key]!.rows, { pattern: 'profile' }).kind, 'single', c!.query);
    }
  });

  test('the "Based in Northamptonshire" choice re-asks "John Smith in Northamptonshire"', () => {
    const d = run('ls-js');
    assert.equal(d.kind, 'choices');
    if (d.kind !== 'choices') return;
    const c = d.choices.find((x) => x.descriptor === 'Based in Northamptonshire');
    assert.ok(c, d.choices.map((x) => x.descriptor).join(' | '));
    assert.equal(c!.query, 'John Smith in Northamptonshire', c!.query);
    assert.equal(isPersonAsk(c!.query), true, c!.query);
    assert.equal(personSubject(c!.query), 'John Smith', c!.query);
    assert.ok(contextTerms(c!.query).includes('northamptonshire'), c!.query);
    assert.ok(wordsBeyond(c!.query, c!.name) <= 3, c!.query);
    for (const stop of ['of', 'in', 'at']) assert.ok(!contextTerms(c!.query).includes(stop), c!.query);
  });

  test('no recorded choice re-asks the bare name', () => {
    for (const key of ['ls-ray', 'ls-dk', 'ls-js', 'serper-ray', 'serper-ray1', 'serper-dk', 'serper-js']) {
      const d = run(key);
      assert.equal(d.kind, 'choices', key);
      if (d.kind !== 'choices') continue;
      assert.ok(d.choices.length >= 2, `${key}: ${d.choices.length} choices`);
      for (const c of d.choices) {
        assert.notEqual(c.query, c.name, `${key}: ${c.query}`);
        assert.equal(personSubject(c.query), c.name, `${key}: ${c.query}`);
        assert.ok(wordsBeyond(c.query, c.name) <= 3, `${key}: ${c.query}`);
      }
    }
  });
});
