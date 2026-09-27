import type { AnswerCard, CardNode, CardPattern } from '../shared/card';

interface PatternDef extends CardPattern {
  skeleton: CardNode[];
}

const slot = (hint: string, shape: Extract<CardNode, { type: 'slot' }>['shape'] = 'line'): CardNode => ({ type: 'slot', hint, shape });
const row = (...children: CardNode[]): CardNode => ({ type: 'stack', direction: 'row', gap: 'md', children });
const grid = (cols: 2 | 3 | 4, ...children: CardNode[]): CardNode => ({ type: 'grid', cols, gap: 'md', children });
const section = (title: string, ...children: CardNode[]): CardNode => ({ type: 'section', title, children });

export const PATTERNS: PatternDef[] = [
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'One big headline value (a current reading, price, score, count or status) with small supporting tiles, a short series over time, and a few details',
    skeleton: [
      row(slot('headline value', 'hero'), slot('context', 'block')),
      { type: 'scroller', children: [slot('series', 'tile'), slot('series', 'tile'), slot('series', 'tile'), slot('series', 'tile'), slot('series', 'tile')] },
      grid(2, slot('detail', 'tile'), slot('detail', 'tile'), slot('detail', 'tile'), slot('detail', 'tile')),
    ],
  },
  {
    id: 'answer',
    label: 'Direct answer',
    description: 'A short factual question with a direct answer, followed by a few supporting facts',
    skeleton: [slot('direct answer', 'hero'), slot('explanation', 'block'), section('Good to know', slot('fact'), slot('fact'), slot('fact'))],
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'A single person, organisation, place or thing shown as a profile with a picture, key facts and background',
    skeleton: [slot('profile header', 'row'), grid(2, slot('fact', 'tile'), slot('fact', 'tile'), slot('fact', 'tile'), slot('fact', 'tile')), slot('background', 'block')],
  },
  {
    id: 'compare',
    label: 'Side by side',
    description: 'Two or more options compared attribute by attribute, ending with a verdict',
    skeleton: [grid(2, slot('option A', 'tile'), slot('option B', 'tile')), slot('comparison table', 'block'), slot('verdict', 'line')],
  },
  {
    id: 'ranked',
    label: 'Top picks',
    description: 'A ranked set of recommendations or best options, each with a short reason and rating',
    skeleton: [slot('intro', 'line'), slot('pick', 'row'), slot('pick', 'row'), slot('pick', 'row'), slot('pick', 'row')],
  },
  {
    id: 'steps',
    label: 'Step by step',
    description: 'How to do or make something: requirements, ordered steps and tips',
    skeleton: [row(slot('time or difficulty', 'tile'), slot('requirements', 'tile'), slot('result', 'tile')), slot('steps', 'block'), slot('tip', 'line')],
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'A story that unfolds over time: history, a sequence of events or how something developed',
    skeleton: [slot('overview', 'block'), slot('timeline', 'block'), slot('why it matters', 'line')],
  },
  {
    id: 'dataset',
    label: 'Numbers & trends',
    description: 'Statistics, rankings or measurements best shown as a chart with a few headline numbers',
    skeleton: [grid(3, slot('number', 'tile'), slot('number', 'tile'), slot('number', 'tile')), slot('chart', 'chart'), slot('takeaway', 'line')],
  },
  {
    id: 'explainer',
    label: 'Explainer',
    description: 'A concept or idea explained simply: one-line definition, the key parts, an analogy and why it matters',
    skeleton: [slot('definition', 'hero'), grid(2, slot('key idea', 'block'), slot('key idea', 'block'), slot('key idea', 'block'), slot('key idea', 'block')), slot('analogy', 'line')],
  },
  {
    id: 'visual',
    label: 'Visual tour',
    description: 'Something best understood by seeing it: pictures first, then highlights and practical details',
    skeleton: [slot('pictures', 'chart'), slot('highlights', 'block'), grid(2, slot('detail', 'tile'), slot('detail', 'tile'))],
  },
  {
    id: 'briefing',
    label: 'Briefing',
    description: 'Latest news or developments: the headline story, what happened, and related updates',
    skeleton: [slot('headline story', 'hero'), slot('what happened', 'block'), section('Related updates', slot('update'), slot('update'), slot('update'))],
  },
  {
    id: 'decision',
    label: 'Decision helper',
    description: 'Helping decide whether to do or choose something: pros and cons, key considerations and a verdict',
    skeleton: [slot('verdict', 'hero'), slot('pros and cons', 'block'), slot('considerations', 'block')],
  },
];

export const PATTERN_IDS = PATTERNS.map((p) => p.id);

export function patternById(id: string): PatternDef {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[1];
}

export function skeletonCard(query: string, patternId: string): AnswerCard {
  return { title: query, subtitle: patternById(patternId).label, body: patternById(patternId).skeleton };
}

export function heuristicPattern(q: string): string {
  const s = q.toLowerCase();
  if (/\b(vs\.?|versus|compare|or)\b/.test(s) && /\b(vs\.?|versus|compare)\b/.test(s)) return 'compare';
  if (/^(how (to|do i|can i)|steps to|recipe|guide)/.test(s)) return 'steps';
  if (/\b(best|top \d+|recommend)\b/.test(s)) return 'ranked';
  if (/\b(should i|worth it|is it good)\b/.test(s)) return 'decision';
  if (/\b(news|latest|today|update)\b/.test(s)) return 'briefing';
  if (/\b(history|timeline|origin|evolution)\b/.test(s)) return 'timeline';
  if (/\b(current|right now|price|score|rate|forecast)\b/.test(s)) return 'spotlight';
  if (/\b(statistics|stats|population|how many|growth|trend)\b/.test(s)) return 'dataset';
  if (/^(what is|what are|explain|define)/.test(s)) return 'explainer';
  if (/^(who is|who was)/.test(s)) return 'profile';
  if (/\b(photos|pictures|images|places to visit|things to do)\b/.test(s)) return 'visual';
  return 'answer';
}
