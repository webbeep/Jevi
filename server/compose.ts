import type {
  Action,
  ActionId,
  AiTask,
  ComponentKind,
  Intent,
  KeyPoint,
  Layout,
  SearchResponse,
  Stat,
  SummaryLength,
  TimelineItem,
} from '../shared/types';
import { hasDeepSeek } from './deepseek';
import { JevQuestion, askJev, choice, jevKey, noul, score } from './jev';
import { Env, clip } from './util';

type OptionalKind = Exclude<ComponentKind, 'answer' | 'results' | 'key_points'>;

const INTENTS: Record<Intent, string | null> = {
  definition: 'What something is or means',
  how_to: 'How to do or make something',
  comparison: 'Comparing options, X vs Y, best of',
  news: 'Recent events or current news',
  person: 'About a specific person',
  place: 'About a location, city, country or venue',
  product: 'A product, tool, app or service to buy or use',
  statistics: 'Numbers, prices, sizes, rankings or data',
  history: 'Historical background or timeline',
  opinion: 'Opinions, reviews, recommendations',
  technical: 'Programming, science or technical detail',
  general: null,
};

const COMPONENT_QUESTIONS: Record<OptionalKind, string> = {
  summary: 'The search snippets do not directly answer the query on their own; a short synthesized written overview would help the searcher.',
  knowledge: 'The query is about one specific entity (person, place, organisation, thing) that deserves a profile card with a picture and overview.',
  stats: 'The searcher would benefit from seeing key numbers, figures, prices or statistics as big visual tiles.',
  timeline: 'The topic involves a history or sequence of dated events that is worth showing on a timeline.',
  gallery: 'Seeing pictures would significantly help the searcher understand or enjoy this topic.',
  comparison: 'The query compares two or more things, or a side-by-side comparison table of options would help.',
  steps: 'The searcher wants to know how to do something, step by step.',
  pros_cons: 'The searcher is weighing a decision where a list of pros and cons would help.',
  discussion: 'Community opinions or tech discussion threads would add useful perspective.',
};

const LEAD_OPTIONS: Record<OptionalKind, string> = {
  summary: 'A written overview',
  knowledge: 'An entity profile card',
  stats: 'Big number tiles',
  timeline: 'A timeline of events',
  gallery: 'An image gallery',
  comparison: 'A comparison table',
  steps: 'Numbered steps',
  pros_cons: 'Pros and cons',
  discussion: 'Community discussion',
};

const ACTIONS: Record<ActionId, { label: string; when: string; suffix: string }> = {
  simpler: { label: 'Explain simply', when: 'The topic is complex or technical enough that a plain-language explanation would help.', suffix: 'explained simply' },
  deeper: { label: 'Go deeper', when: 'The topic is broad with a lot more to learn beyond a quick answer.', suffix: 'in depth guide' },
  latest: { label: 'Latest news', when: 'The topic has ongoing or recent developments worth following.', suffix: 'latest news' },
  alternatives: { label: 'Alternatives', when: 'The query is about a product, tool, service or option that has alternatives.', suffix: 'alternatives' },
  howto: { label: 'How to', when: 'There is a practical, actionable thing the searcher might want to do next.', suffix: 'how to' },
  images: { label: 'More pictures', when: 'The topic is visual, like a place, animal, design, food or artwork.', suffix: 'photos' },
  reviews: { label: 'Reviews', when: 'The searcher might want opinions or reviews before a decision.', suffix: 'reviews' },
  history: { label: 'History', when: 'The subject has an interesting history or origin story.', suffix: 'history' },
};

const DEFAULT_ORDER: ComponentKind[] = [
  'answer', 'summary', 'knowledge', 'stats', 'comparison', 'steps', 'pros_cons', 'gallery', 'timeline', 'key_points', 'discussion', 'results',
];

const AI_KINDS: Partial<Record<ComponentKind, AiTask>> = {
  summary: 'summary',
  comparison: 'comparison',
  steps: 'steps',
  pros_cons: 'pros_cons',
};

interface Candidate extends KeyPoint {
  id: string;
}

function candidates(search: SearchResponse): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const sources = [
    ...(search.knowledge ? [{ text: search.knowledge.extract, url: search.knowledge.url, domain: 'wikipedia' }] : []),
    ...search.results.slice(0, 14).map((r) => ({ text: r.snippet, url: r.url, domain: r.domain })),
  ];
  for (const src of sources) {
    for (const raw of src.text.split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)) {
      const text = raw.replace(/^\W*(\w{3} \d{1,2}, \d{4}\s*[-—·]\s*)?/, '').trim();
      const key = text.toLowerCase().slice(0, 60);
      if (text.length < 35 || text.length > 260 || seen.has(key) || /\.\.\.$|…$/.test(text) && text.length < 60) continue;
      seen.add(key);
      out.push({ id: `s${out.length}`, text, url: src.url, domain: src.domain });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

const STAT_RE =
  /(?:[$€£¥]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion|trillion)?|\d[\d,.]*\s?(?:%|percent|million|billion|trillion|thousand|km²?|kg|miles|mph|km\/h|meters|metres|feet|ft|people|users|years old|°[CF]|GB|TB|hours|minutes))/i;

function extractStats(cands: Candidate[]): Stat[] {
  const stats: Stat[] = [];
  const seenValues = new Set<string>();
  for (const c of cands) {
    const m = c.text.match(STAT_RE);
    if (!m) continue;
    const value = m[0].trim();
    if (seenValues.has(value)) continue;
    seenValues.add(value);
    stats.push({ value, label: clip(c.text, 110), url: c.url });
    if (stats.length >= 6) break;
  }
  return stats;
}

const YEAR_RE = /\b(?:in |since |by |from )?((?:1[0-9]|20)\d{2})\b/;

function extractTimeline(cands: Candidate[]): TimelineItem[] {
  const byYear = new Map<string, TimelineItem>();
  for (const c of cands) {
    const year = c.text.match(YEAR_RE)?.[1];
    if (!year || Number(year) > new Date().getFullYear() + 1 || byYear.has(year)) continue;
    byYear.set(year, { when: year, text: clip(c.text, 160), url: c.url });
  }
  return [...byYear.values()].sort((a, b) => Number(a.when) - Number(b.when)).slice(0, 8);
}

function describeResults(search: SearchResponse): string {
  const lines = search.results.slice(0, 10).map((r, i) => `${i + 1}. ${r.title} (${r.domain}) — ${clip(r.snippet, 220)}`);
  const extras = [
    search.knowledge ? `Encyclopedia: ${search.knowledge.title} — ${clip(search.knowledge.extract, 300)}` : '',
    `Available images: ${search.images.length}. Discussion threads: ${search.discussions.length}.`,
  ].filter(Boolean);
  return `Search query: "${search.query}"\n\nTop results:\n${lines.join('\n')}\n\n${extras.join('\n')}`;
}

function buildActions(query: string, ranked: [ActionId, number][]): Action[] {
  return ranked
    .filter(([, p]) => p >= 0.35)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => ({ id, label: ACTIONS[id].label, query: `${query} ${ACTIONS[id].suffix}` }));
}

function heuristicIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/\b(vs\.?|versus|compare|comparison|better than|best)\b/.test(s)) return 'comparison';
  if (/^(how (to|do|can)|steps to|guide)/.test(s)) return 'how_to';
  if (/^(what is|what are|define|meaning of|who is)/.test(s)) return s.startsWith('who') ? 'person' : 'definition';
  if (/\b(news|latest|today|update)\b/.test(s)) return 'news';
  if (/\b(price|cost|how many|how much|population|statistics|stats)\b/.test(s)) return 'statistics';
  if (/\b(history|origin|timeline)\b/.test(s)) return 'history';
  if (/\b(review|worth it|should i|recommend)\b/.test(s)) return 'opinion';
  return 'general';
}

function availability(search: SearchResponse, stats: Stat[], timeline: TimelineItem[], ai: boolean): Record<OptionalKind, boolean> {
  return {
    summary: ai,
    comparison: ai,
    steps: ai,
    pros_cons: ai,
    knowledge: !!search.knowledge,
    stats: stats.length >= 2,
    timeline: timeline.length >= 3,
    gallery: search.images.length >= 3,
    discussion: search.discussions.length >= 2,
  };
}

function assemble(parts: {
  lead?: OptionalKind;
  chosen: Set<ComponentKind>;
  hasAnswer: boolean;
  keyPoints: KeyPoint[];
}): ComponentKind[] {
  const { lead, chosen, hasAnswer, keyPoints } = parts;
  if (hasAnswer) chosen.add('answer');
  if (keyPoints.length >= 2) chosen.add('key_points');
  chosen.add('results');
  const order = DEFAULT_ORDER.filter((k) => chosen.has(k));
  if (lead && chosen.has(lead)) {
    const at = hasAnswer ? 1 : 0;
    order.splice(order.indexOf(lead), 1);
    order.splice(at, 0, lead);
  }
  return order;
}

function aiTasksFor(blocks: ComponentKind[], ai: boolean): AiTask[] {
  if (!ai) return [];
  const tasks = blocks.map((b) => AI_KINDS[b]).filter((t): t is AiTask => !!t);
  return [...tasks, 'followups'];
}

function heuristicLayout(search: SearchResponse, env: Env, started: number): Layout {
  const ai = hasDeepSeek(env);
  const cands = candidates(search);
  const stats = extractStats(cands);
  const timeline = extractTimeline(cands);
  const intent = heuristicIntent(search.query);
  const avail = availability(search, stats, timeline, ai);
  const wants: Record<Intent, OptionalKind[]> = {
    definition: ['summary', 'knowledge', 'gallery'],
    how_to: ['steps', 'summary'],
    comparison: ['comparison', 'pros_cons', 'summary'],
    news: ['summary', 'timeline', 'discussion'],
    person: ['knowledge', 'summary', 'timeline', 'gallery'],
    place: ['knowledge', 'gallery', 'stats', 'summary'],
    product: ['summary', 'pros_cons', 'gallery'],
    statistics: ['stats', 'summary'],
    history: ['timeline', 'summary', 'knowledge'],
    opinion: ['pros_cons', 'discussion', 'summary'],
    technical: ['summary', 'steps', 'discussion'],
    general: ['summary', 'knowledge', 'gallery'],
  };
  const chosen = new Set<ComponentKind>(wants[intent].filter((k) => avail[k]));
  const keyPoints = cands.slice(0, 5);
  const blocks = assemble({ lead: wants[intent].find((k) => avail[k]), chosen, hasAnswer: false, keyPoints });
  return {
    intent,
    intentConfidence: 0.5,
    blocks,
    keyPoints,
    stats,
    timeline,
    aiTasks: aiTasksFor(blocks, ai),
    summaryLength: 'medium',
    actions: buildActions(search.query, [['deeper', 0.6], ['latest', 0.5], ['simpler', 0.45], ['alternatives', 0.4]]),
    engine: 'heuristic',
    ms: Date.now() - started,
  };
}

export async function compose(search: SearchResponse, env: Env): Promise<Layout> {
  const started = Date.now();
  if (!jevKey(env) || !search.results.length) return heuristicLayout(search, env, started);

  const ai = hasDeepSeek(env);
  const cands = candidates(search);
  const stats = extractStats(cands);
  const timeline = extractTimeline(cands);
  const avail = availability(search, stats, timeline, ai);
  const optional = (Object.keys(COMPONENT_QUESTIONS) as OptionalKind[]).filter((k) => avail[k]);

  const questions: Record<string, JevQuestion> = {
    intent: { type: 'choice', instructions: 'What is the searcher mainly looking for?', criteria: INTENTS },
    depth: {
      type: 'score',
      instructions: 'How much written explanation does the searcher need?',
      criteria: ['A one-line fact is enough', 'A short paragraph', 'A detailed multi-paragraph explanation'],
    },
  };
  for (const k of optional) questions[`show_${k}`] = { type: 'noul', instructions: COMPONENT_QUESTIONS[k] };
  if (optional.length >= 2) {
    questions.lead = {
      type: 'choice',
      instructions: 'Which visual component should appear first to help the searcher digest the answer fastest?',
      criteria: Object.fromEntries(optional.map((k) => [k, LEAD_OPTIONS[k]])),
    };
  }
  if (cands.length >= 2) {
    questions.best_sentence = {
      type: 'choice',
      instructions: 'Which sentence most directly and factually answers the search query?',
      criteria: Object.fromEntries(cands.map((c) => [c.id, c.text])),
    };
  }
  for (const id of Object.keys(ACTIONS) as ActionId[]) questions[`action_${id}`] = { type: 'noul', instructions: ACTIONS[id].when };

  let answers;
  try {
    answers = await askJev(env, describeResults(search), questions);
  } catch (err) {
    console.error('Jev compose failed, using heuristics', err);
    return heuristicLayout(search, env, started);
  }

  const intentAnswer = choice(answers, 'intent');
  const intent = (intentAnswer?.choice as Intent) ?? heuristicIntent(search.query);
  const chosen = new Set<ComponentKind>(optional.filter((k) => noul(answers, `show_${k}`) >= 0.5));

  const best = choice(answers, 'best_sentence');
  const ranked = best
    ? Object.entries(best.probabilities).sort((a, b) => b[1] - a[1]).map(([id, p]) => ({ c: cands.find((c) => c.id === id)!, p })).filter((x) => x.c)
    : [];
  const top = ranked[0];
  const answer = top && top.p >= 0.3 ? { text: top.c.text, url: top.c.url, domain: top.c.domain, confidence: top.p } : undefined;
  const keyPoints = ranked.slice(answer ? 1 : 0, answer ? 6 : 5).map(({ c }) => ({ text: c.text, url: c.url, domain: c.domain }));

  if (!answer && ai) chosen.add('summary');

  const depth = score(answers, 'depth') ?? 1;
  const summaryLength: SummaryLength = depth < 0.7 ? 'short' : depth < 1.4 ? 'medium' : 'long';
  const lead = choice(answers, 'lead')?.choice as OptionalKind | undefined;
  const blocks = assemble({ lead, chosen, hasAnswer: !!answer, keyPoints });

  return {
    intent,
    intentConfidence: intentAnswer?.confidence ?? 0,
    blocks,
    answer,
    keyPoints,
    stats,
    timeline,
    aiTasks: aiTasksFor(blocks, ai),
    summaryLength,
    actions: buildActions(
      search.query,
      (Object.keys(ACTIONS) as ActionId[]).map((id) => [id, noul(answers, `action_${id}`)]),
    ),
    engine: 'jev',
    ms: Date.now() - started,
  };
}
