import { personName } from '../shared/askAbout';
import { withoutRepeatedLead, type AnswerCard, type CardNode, type CardPattern } from '../shared/card';
import { isBriefingQuery } from '../shared/recency';
import { asksLocalConditions } from './readings';

interface PatternDef extends CardPattern {
  skeleton: CardNode[];
}

const slot = (hint: string, shape: Extract<CardNode, { type: 'slot' }>['shape'] = 'line', size?: { cols?: number; rows?: number }): CardNode => ({ type: 'slot', hint, shape, ...size });

/** The things a comparison names ("AJ Dybantsa vs 2026 NBA rookies vs past draft classes" is three). */
export function compareSides(query: string): string[] {
  const stripped = query.replace(/^(?:which is better(?: value)?|compare)\s*:\s*/i, '').trim();
  const versus = stripped.split(/\s+(?:vs\.?|versus)\s+/i).map((p) => p.trim()).filter((p) => p.length >= 2);
  if (versus.length >= 2) return versus;
  const compared = stripped.match(/^compare\s+(.+?)\s+(?:and|with|to)\s+(.+)$/i);
  if (!compared) return [];
  return [compared[1]!, compared[2]!].map((p) => p.trim()).filter((p) => p.length >= 2);
}

/**
 * Searches for every side except the first. The literal question already leads with that
 * name, and a "vs" page is usually about the first name alone.
 * A league named on another side ("NBA") is added when this side doesn't say it.
 */
export function compareSideQueries(query: string): string[] {
  const sides = compareSides(query);
  if (sides.length < 2) return [];
  const league = query.match(/\b(?:NBA|NFL|MLB|NHL|WNBA)\b/i)?.[0]?.toUpperCase();
  return sides.slice(1, 3).map((side) => (league && !new RegExp(`\\b${league}\\b`, 'i').test(side) ? `${league} ${side}` : side));
}

/** How many sides a comparison names ("renting vs buying" is 2). Two when it doesn't say. */
export function compareCount(query: string): 2 | 3 | 4 {
  const n = compareSides(query).length;
  if (n >= 4) return 4;
  if (n === 3) return 3;
  return 2;
}

/** Tiles for each side, then a table with one column per side plus the factor column. */
function compareSkeleton(query: string): CardNode[] {
  const n = compareCount(query);
  const tiles = Array.from({ length: n }, (_, i) => slot(`option ${i + 1}`, 'tile'));
  return [
    grid(n, ...tiles),
    slot('comparison table: one row per factor, first column the factor, then one column per option', 'table', { cols: n + 1, rows: 4 }),
    slot('verdict', 'line'),
  ];
}
/**
 * A local reading has one current value. The spotlight row (hero beside a context
 * block, then a series, then a detail grid) makes every region restate that value.
 * The place is the card title, so the hero is the temperature and the sky only.
 */
function weatherSkeleton(): CardNode[] {
  return [
    slot('current temperature: the value is the temperature and the caption is the sky only. Do not put the place, humidity, dew point, wind, or pressure here', 'hero'),
    {
      type: 'scroller',
      children: [
        slot('a later period only (tonight, tomorrow, or a later day) with its own temperature — never the current reading and never a Now card', 'tile'),
        slot('the next later period', 'tile'),
        slot('the next later period', 'tile'),
        slot('the next later period', 'tile'),
        slot('the next later period', 'tile'),
      ],
    },
    grid(2, slot('one extra reading not in the hero, such as humidity, wind, or pressure', 'tile'), slot('a different extra reading', 'tile'), slot('a different extra reading', 'tile'), slot('a different extra reading', 'tile')),
  ];
}

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
      { type: 'scroller', children: [slot('series over time: tiles for a few upcoming values, or a line chart for a longer trend', 'tile'), slot('series', 'tile'), slot('series', 'tile'), slot('series', 'tile'), slot('series', 'tile')] },
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
    skeleton: compareSkeleton(''),
  },
  {
    id: 'ranked',
    label: 'Top picks',
    description: 'A ranked set of recommendations or best options, each with a short reason and rating',
    skeleton: [slot('the verdict: top pick and why', 'hero'), { type: 'stack', gap: 'sm', children: [slot('ranked picks with pictures', 'row'), slot('ranked picks with pictures', 'row'), slot('ranked picks with pictures', 'row')] }, slot('what to look for', 'block')],
  },
  {
    id: 'steps',
    label: 'Step by step',
    description: 'How to do or make something: requirements, ordered steps and tips',
    skeleton: [row(slot('time or difficulty', 'tile'), slot('requirements', 'tile'), slot('result', 'tile')), slot('steps', 'steps', { rows: 4 }), slot('tip', 'line')],
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'A story that unfolds over time: history, a sequence of events or how something developed',
    skeleton: [slot('overview', 'block'), slot('timeline', 'timeline', { rows: 4 }), slot('why it matters', 'line')],
  },
  {
    id: 'dataset',
    label: 'Numbers & trends',
    description: 'One comparable magnitude ranked or trended (population, revenue, a rate over time), shown as a chart. Not a schedule, a slate of game scores, or clock times — those are a table',
    skeleton: [grid(3, slot('number', 'tile'), slot('number', 'tile'), slot('number', 'tile')), slot('chart', 'chart'), slot('takeaway', 'line')],
  },
  {
    id: 'explainer',
    label: 'Explainer',
    description: 'A concept or idea explained simply: one-line definition, the key parts, an analogy and why it matters',
    skeleton: [slot('the idea in one value or sentence', 'hero'), grid(2, slot('key part', 'tile'), slot('key part', 'tile'), slot('key part', 'tile'), slot('key part', 'tile')), slot('how the parts fit together', 'block'), slot('analogy', 'line')],
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
    id: 'draft',
    label: 'Draft',
    description: 'Asks to have something written or rewritten — an email, message, post, letter, bio, caption, cover letter or speech: the finished text first, then tone and length options',
    skeleton: [slot('the finished draft', 'block'), slot('tone, length or audience options', 'line'), slot('tips for sending or using it', 'line')],
  },
  {
    id: 'code',
    label: 'Code',
    description: 'Programming help — write, fix, convert or explain code, a formula, a query or a command: working code first, then how it works and how to run it',
    skeleton: [slot('one-line answer', 'line'), slot('the code', 'block'), slot('how it works', 'block')],
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'A plan or schedule to follow — trip itinerary, workout, study, meal or savings plan: key numbers up front, then the plan by day or phase',
    skeleton: [row(slot('duration', 'tile'), slot('budget or effort', 'tile'), slot('focus', 'tile')), slot('the plan by day or phase, in tabs', 'block'), slot('tips', 'line')],
  },
  {
    id: 'decision',
    label: 'Decision helper',
    description: 'Helping decide whether to do or choose something: pros and cons, key considerations and a verdict',
    skeleton: [slot('verdict', 'hero'), slot('pros and cons', 'proscons'), slot('considerations', 'block')],
  },
];

export const PATTERN_IDS = PATTERNS.map((p) => p.id);

export function patternById(id: string): PatternDef {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[1];
}

/** The skeleton for this ask. A comparison grows a column and a tile for each side it names. */
export function patternSkeleton(id: string, query = ''): CardNode[] {
  if (id === 'compare') return compareSkeleton(query);
  if (id === 'spotlight' && asksLocalConditions(query)) return weatherSkeleton();
  return patternById(id).skeleton;
}

export function skeletonCard(query: string, patternId: string): AnswerCard {
  return { title: withoutRepeatedLead(query), subtitle: patternById(patternId).label, body: patternSkeleton(patternId, query) };
}

/** Layouts where the answer is something produced for the person rather than facts from the web. */
export const MADE_PATTERNS = new Set(['draft', 'code']);

export function heuristicPattern(q: string): string {
  const s = q.toLowerCase();
  if (/^(write|draft|rewrite|reword|compose|proofread|polish|make (this|it) (sound|more))\b/.test(s) || /\b(email|cover letter|caption|linkedin post|toast|speech) (to|for|about)\b/.test(s)) return 'draft';
  if (/\b(code|function|script|regex|sql|query|python|javascript|typescript|bash|excel formula|error|exception|bug)\b/.test(s) && /^(write|fix|how (do|to|can)|convert|debug|why does|what does)/.test(s)) return 'code';
  if ((/\b(weather|forecast)\b/.test(s) || (/\btemperature\b/.test(s) && !/^(what is|what are|explain|define)/.test(s))) && !/\b(how (?:do|does)|why (?:do|does|is)|climate|historical|history)\b/.test(s)) return 'spotlight';
  if (/\b(itinerary|workout plan|meal plan|study plan|schedule|routine|\d+[- ]day)\b/.test(s)) return 'plan';
  if (/\b(vs\.?|versus|compare|or)\b/.test(s) && /\b(vs\.?|versus|compare)\b/.test(s)) return 'compare';
  if (/^(how (to|do i|can i)|steps to|recipe|guide)/.test(s)) return 'steps';
  if (/\b(best|top \d+|recommend)\b/.test(s)) return 'ranked';
  if (/\b(should i|worth it|is it good)\b/.test(s)) return 'decision';
  if (isBriefingQuery(s)) return 'briefing';
  if (/\b(history|timeline|origin|evolution)\b/.test(s)) return 'timeline';
  if (/\b(scores|box scores?|highlights|fixtures|slate|tip-?offs?|kick-?offs?)\b/.test(s)) return 'briefing';
  if (/\b(current|right now|price|score|rate)\b/.test(s)) return 'spotlight';
  if (/\btemperature\b/.test(s) && !/^(what is|what are|explain|define)/.test(s)) return 'spotlight';
  if (/\b(statistics|stats|population|how many|growth|trend)\b/.test(s)) return 'dataset';
  const named = q.match(/^(?:what|who)\s+(?:is|was)\s+(.+?)\s*\??$/i);
  if (named && personName(named[1].trim())) return 'profile';
  if (/^(what is|what are|explain|define)/.test(s) || /^how (do|does)\b/.test(s) || /\bhow\b.*\bworks?\b/.test(s)) return 'explainer';
  if (/^(who is|who was)/.test(s)) return 'profile';
  if (/\b(photos|pictures|images|places to visit|things to do)\b/.test(s)) return 'visual';
  return 'answer';
}
