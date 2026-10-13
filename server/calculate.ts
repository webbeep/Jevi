import type { AnswerCard, CardNode } from '../shared/card';

/**
 * A follow-up that asks to calculate stays on the figures already on the card and in its
 * sources. The answer is the arithmetic. It does not open a new article, and a headline
 * never becomes the body. Each number keeps the unit and the label attached to it.
 */

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

const STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'over', 'from', 'his', 'her', 'their', 'its',
  'at', 'to', 'by', 'per', 'than', 'that', 'this', 'into', 'during', 'after', 'before', 'about', 'just', 'only',
  'played', 'scored', 'recorded', 'had', 'has', 'have', 'was', 'were', 'is', 'are', 'be', 'been', 'he', 'she',
  'they', 'who', 'also', 'notes', 'note', 'over', 'under', 'across', 'through', 'while', 'when', 'where',
]);

/** Words that are a measure's name when they sit next to the number. Anything else is not the label. */
const LABEL_WORD = /^(?:weight|weighs|weighing|rent|rents|utility|utilities|flour|sugar|population|populations|distance|price|prices|cost|costs|tax|taxes|calorie|calories|salary|revenue|income|fare|fee|budget|height|age|temperature|speed|length|width|area|volume)$/i;

const ALIAS: Record<string, string[]> = {
  points: ['ppg', 'point', 'points', 'pts'],
  rebounds: ['rpg', 'rebound', 'rebounds'],
  assists: ['apg', 'assist', 'assists'],
  steals: ['spg', 'steal', 'steals'],
  blocks: ['bpg', 'block', 'blocks'],
  minutes: ['mpg', 'minute', 'minutes', 'mins'],
  games: ['game', 'games'],
  weight: ['weight', 'kg', 'kilogram', 'kilograms', 'lb', 'lbs', 'pound', 'pounds'],
  dollars: ['dollar', 'dollars', 'usd'],
  rent: ['rent', 'rents'],
  utilities: ['utility', 'utilities'],
  calories: ['calorie', 'calories', 'kcal'],
  population: ['population', 'populations', 'people'],
  cups: ['cup', 'cups'],
};

const DIVISORS = new Set(['games', 'minutes', 'hours', 'days', 'people', 'servings', 'items']);

const NOT_CALC = /^(?:how (?:do|to|can|would)|explain|what is the formula|define)\b/i;

const CALC_PATTERNS = [
  /\bdo the maths?\b/i,
  /\b(?:crunch|run) the numbers\b/i,
  /\bwork (?:it|that|this|them) out\b/i,
  /\bfigure out the (?:total|sum|average|difference)\b/i,
  /\badd the\b.+\b(?:and|plus)\b/i,
  /\badd (?:them|those|these|it|that)(?:\s+up|\s+together)?\b/i,
  /\b(?:sum|total) (?:them|those|these|it|that)(?:\s+up)?\b/i,
  /\bwhat(?:'s| is) the (?:combined )?(?:total|sum|average|mean|difference|ratio)\b/i,
  /\b(?:combined total|altogether)\b/i,
  /\bcalculate (?:that|this|it|them|those|the)\b/i,
  /\b(?:what(?:'s| is)|calculate|compute|find)\b[^?]{0,48}\bper\s+(?:game|minute|hour|day|person|serving)\b/i,
  /\d[\d,]*(?:\.\d+)?\s*(?:[-+*/x×÷]|plus|minus|times)\s*\d/i,
];

export interface Figure {
  label: string;
  /** Canonical unit: "kg", "minutes", "$", "PPG". Empty when the label is the only name. */
  unit: string;
  amount: number;
  /** The number as the source wrote it. A clock stays "15:07". */
  display: string;
  clock?: boolean;
  /** A rate such as PPG. It is not added to a raw total unless the question names it. */
  rate?: boolean;
}

export interface CalculationCard {
  title: string;
  subtitle: string;
  nodes: CardNode[];
}

interface LooseSearch {
  knowledge?: { extract?: string };
  results?: { title?: string; snippet?: string; content?: string }[];
}

type Op = 'sum' | 'average' | 'difference' | 'product' | 'ratio' | 'rate' | 'bare';

/** "Can you just do the math", "add the two totals", "what's the average of those". Not a how-to. */
export function isCalculationAsk(question: string): boolean {
  const q = question.trim();
  if (!q || NOT_CALC.test(q)) return false;
  return CALC_PATTERNS.some((re) => re.test(q));
}

/** Keeps capitals already on the card. A fully lowercase subject is title-cased. */
export function subjectTitle(query: string, prior?: string): string {
  const proposed = query.trim().replace(/[?.!]+$/g, '').replace(/\s+/g, ' ');
  const priorClean = prior?.trim().replace(/\s+/g, ' ') ?? '';
  if (!proposed) return priorClean;
  if (priorClean && priorClean.toLowerCase() === proposed.toLowerCase()) return priorClean;
  const caps = new Map(priorClean.split(/\s+/).filter(Boolean).map((w) => [w.toLowerCase().replace(/[^a-z0-9]+/g, ''), w]));
  return proposed.split(/\s+/).map((word, i) => {
    if (word !== word.toLowerCase()) return word;
    const borrowed = caps.get(word.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (borrowed) return borrowed;
    if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

const CLOCK_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b(?:\s*(minutes|minute|mins|min|hours|hour|hrs|hr|seconds|second|secs|sec))?/gi;
const MONEY_RE = /[$€£¥]\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn|million|billion|trillion|thousand))?/gi;
const ABBR_RE = /\b(PPG|RPG|APG|SPG|BPG|MPG|FG%|FT%|3P%)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)\b|\b(\d[\d,]*(?:\.\d+)?)\s*(PPG|RPG|APG|SPG|BPG|MPG|FG%|FT%|3P%)\b/gi;
const LEAD_RE = /\b(points|point|pts|rebounds|rebound|assists|assist|steals|steal|blocks|block|games|game|minutes|minute|hours|hour|dollars|dollar|calories|kcal|people|cups|cup|kg|lb|lbs)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)(?!\s*(?:%|percent|kg|lb|lbs|pounds|minutes|minute|hours|hour|points|point|games|game))/gi;
const UNIT_RE = /\b(\d[\d,]*(?:\.\d+)?)(?:\s*(million|billion|trillion|thousand))?\s*(%|percent|kg|kilograms|lb|lbs|pounds|minutes|minute|mins|min|hours|hour|hrs|hr|seconds|second|secs|sec|miles|mph|km\/h|km|meters|metres|feet|ft|people|users|years old|GB|TB|points|point|pts|rebounds|rebound|assists|assist|steals|steal|blocks|block|games|game|cups|cup|calories|kcal|dollars|dollar|servings|serving|items|item|days|day)/gi;

interface Hit { start: number; end: number; figure: Figure }

function occupied(hits: Hit[], start: number, end: number): boolean {
  return hits.some((hit) => start < hit.end && end > hit.start);
}

function scale(n: number, mag?: string): number {
  switch (mag?.toLowerCase()) {
    case 'k':
    case 'thousand':
      return n * 1e3;
    case 'm':
    case 'million':
      return n * 1e6;
    case 'bn':
    case 'billion':
      return n * 1e9;
    case 'trillion':
      return n * 1e12;
    default:
      return n;
  }
}

function parseAmount(raw: string, mag?: string): number {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? scale(n, mag) : Number.NaN;
}

export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  const [whole, frac] = String(rounded).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${withCommas}.${frac}` : withCommas;
}

function canonical(unit: string): string {
  const u = unit.toLowerCase().replace(/\.$/, '');
  if (['kg', 'kilogram', 'kilograms'].includes(u)) return 'kg';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return 'lb';
  if (['minute', 'minutes', 'min', 'mins'].includes(u)) return 'minutes';
  if (['hour', 'hours', 'hr', 'hrs'].includes(u)) return 'hours';
  if (['second', 'seconds', 'sec', 'secs'].includes(u)) return 'seconds';
  if (['point', 'points', 'pts'].includes(u)) return 'points';
  if (['rebound', 'rebounds'].includes(u)) return 'rebounds';
  if (['assist', 'assists'].includes(u)) return 'assists';
  if (['steal', 'steals'].includes(u)) return 'steals';
  if (['block', 'blocks'].includes(u)) return 'blocks';
  if (['game', 'games'].includes(u)) return 'games';
  if (['dollar', 'dollars', 'usd', '$'].includes(u)) return '$';
  if (['percent', '%'].includes(u)) return '%';
  if (['cup', 'cups'].includes(u)) return 'cups';
  if (['calorie', 'calories', 'kcal'].includes(u)) return 'calories';
  if (['person', 'people', 'user', 'users'].includes(u)) return 'people';
  if (['day', 'days'].includes(u)) return 'days';
  if (['serving', 'servings'].includes(u)) return 'servings';
  if (['item', 'items'].includes(u)) return 'items';
  if (u === 'years old') return 'years';
  return u;
}

function prettyUnit(word: string): string {
  const lower = word.toLowerCase();
  if (['kg', 'lb', 'km', 'mph', 'gb', 'tb', '%'].includes(lower)) return lower === '%' ? '%' : lower;
  if (word.length <= 4 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function nearestLabel(text: string, start: number): string | undefined {
  const before = text.slice(Math.max(0, start - 48), start);
  const words = before.match(/[A-Za-z][A-Za-z%]*/g) ?? [];
  for (let i = words.length - 1; i >= 0 && i >= words.length - 4; i--) {
    const word = words[i]!;
    if (STOP.has(word.toLowerCase())) continue;
    if (/^weigh(?:s|ing)?$/i.test(word)) return 'Weight';
    if (LABEL_WORD.test(word)) return prettyUnit(word);
  }
  return undefined;
}

function push(hits: Hit[], start: number, end: number, figure: Figure | undefined) {
  if (!figure || !Number.isFinite(figure.amount)) return;
  if (occupied(hits, start, end)) return;
  hits.push({ start, end, figure });
}

/** Numbers in a passage, each still wearing the unit and label the passage gave it. */
export function readFigures(text: string): Figure[] {
  const hits: Hit[] = [];
  for (const re of [CLOCK_RE, MONEY_RE, ABBR_RE, LEAD_RE, UNIT_RE]) re.lastIndex = 0;

  for (let match = CLOCK_RE.exec(text); match; match = CLOCK_RE.exec(text)) {
    const clock = match[3] ? `${match[1]}:${match[2]}:${match[3]}` : `${match[1]}:${match[2]}`;
    const unitWord = match[4];
    const unit = unitWord ? canonical(unitWord) : '';
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    const secs = match[3] ? Number(match[3]) : 0;
    push(hits, match.index, match.index + match[0].length, {
      label: unit ? prettyUnit(unit) : 'Time',
      unit: unit || 'time',
      amount: hours * 3600 + mins * 60 + secs,
      display: clock,
      clock: true,
    });
  }

  for (let match = MONEY_RE.exec(text); match; match = MONEY_RE.exec(text)) {
    const amount = parseAmount(match[1]!, match[2]);
    const symbol = match[0].trim().charAt(0);
    push(hits, match.index, match.index + match[0].length, {
      label: nearestLabel(text, match.index) ?? 'Dollars',
      unit: symbol === '$' ? '$' : symbol,
      amount,
      display: formatAmount(amount),
    });
  }

  for (let match = ABBR_RE.exec(text); match; match = ABBR_RE.exec(text)) {
    const abbr = (match[1] || match[4] || '').toUpperCase();
    const raw = match[2] || match[3] || '';
    push(hits, match.index, match.index + match[0].length, {
      label: abbr,
      unit: abbr,
      amount: parseAmount(raw),
      display: formatAmount(parseAmount(raw)),
      rate: true,
    });
  }

  for (let match = LEAD_RE.exec(text); match; match = LEAD_RE.exec(text)) {
    const unit = canonical(match[1] || '');
    push(hits, match.index, match.index + match[0].length, {
      label: prettyUnit(unit),
      unit,
      amount: parseAmount(match[2] || ''),
      display: formatAmount(parseAmount(match[2] || '')),
    });
  }

  for (let match = UNIT_RE.exec(text); match; match = UNIT_RE.exec(text)) {
    const unit = canonical(match[3] || '');
    const amount = parseAmount(match[1]!, match[2]);
    push(hits, match.index, match.index + match[0].length, {
      label: nearestLabel(text, match.index) ?? prettyUnit(unit),
      unit,
      amount,
      display: formatAmount(amount),
    });
  }

  hits.sort((a, b) => a.start - b.start);
  return dedupe(hits.map((hit) => hit.figure));
}

export function figureValue(f: Figure): string {
  if (f.clock) return f.display;
  if (f.unit === '$' || f.unit === '€' || f.unit === '£' || f.unit === '¥') return `${f.unit}${formatAmount(f.amount)}`;
  if (f.unit === '%') return `${formatAmount(f.amount)}%`;
  if (f.rate) return f.display;
  if (f.unit && f.unit.toLowerCase() !== f.label.toLowerCase()) return `${formatAmount(f.amount)} ${f.unit}`;
  return f.unit ? `${formatAmount(f.amount)} ${f.unit}` : f.display;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliases(f: Figure): string[] {
  const blob = `${f.label} ${f.unit}`;
  const out = new Set<string>();
  for (const [name, words] of Object.entries(ALIAS)) {
    if (words.some((word) => new RegExp(`\\b${escapeReg(word)}\\b`, 'i').test(blob))) out.add(name);
  }
  out.add(f.label.toLowerCase());
  if (f.unit) out.add(f.unit.toLowerCase());
  return [...out].filter((name) => name.length >= 2);
}

function figureNamed(question: string, f: Figure): boolean {
  return aliases(f).some((name) => name.length >= 3 && new RegExp(`\\b${escapeReg(name)}\\b`, 'i').test(question));
}

function sameFigure(a: Figure, b: Figure): boolean {
  if (Math.abs(a.amount - b.amount) > 0.001) return false;
  if (a.clock !== b.clock) return false;
  const left = new Set(aliases(a));
  return aliases(b).some((name) => left.has(name));
}

function dedupe(figures: Figure[]): Figure[] {
  const out: Figure[] = [];
  for (const figure of figures) {
    if (out.some((kept) => sameFigure(kept, figure))) continue;
    out.push(figure);
  }
  return out;
}

function fromLabeled(label: string, value: string, unit?: string): Figure[] {
  const blob = [label, value, unit].filter(Boolean).join(' ');
  const parsed = readFigures(blob);
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (parsed.length > 1 || words.length > 6 || label.length > 48 || /\d/.test(label)) return parsed;
  if (parsed.length === 1) {
    const pretty = /^weigh(?:s|ing)?$/i.test(label.trim()) ? 'Weight' : label.trim();
    return [{ ...parsed[0]!, label: pretty || parsed[0]!.label }];
  }
  const bare = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!bare || words.length === 0 || words.length > 4) return [];
  const amount = parseAmount(bare[0]!);
  if (!Number.isFinite(amount)) return [];
  if (!unit && bare[0]!.replace(/,/g, '').length === 4 && amount >= 1800 && amount <= 2099) return [];
  const abbr = /^(?:PPG|RPG|APG|SPG|BPG|MPG|FG%|FT%|3P%)$/i.test(label.trim());
  return [{
    label: label.trim(),
    unit: canonical(unit || label),
    amount,
    display: formatAmount(amount),
    rate: abbr,
  }];
}

function figuresFromNode(node: CardNode): Figure[] {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return node.children.flatMap(figuresFromNode);
    case 'tabs':
      return node.tabs.flatMap((tab) => tab.children.flatMap(figuresFromNode));
    case 'hero':
      return fromLabeled(node.label ?? '', node.value, node.unit);
    case 'stat':
      return fromLabeled(node.label, node.value, node.unit);
    case 'tile':
      return fromLabeled(node.label, node.value ?? '', node.sub);
    case 'keyvalue':
      return node.items.flatMap((item) => fromLabeled(item.label, item.value));
    case 'profile':
      return [
        ...(node.subtitle ? readFigures(node.subtitle) : []),
        ...(node.facts ?? []).flatMap((fact) => fromLabeled(fact.label, fact.value)),
      ];
    case 'heading':
    case 'text':
    case 'quote':
    case 'draft':
      return readFigures(node.text);
    case 'callout':
      return readFigures(`${node.title ?? ''} ${node.text}`);
    case 'table':
      return node.rows.flatMap((row) => row.flatMap((cell, i) => fromLabeled(node.columns[i] ?? '', cell)));
    case 'chart':
      return node.data.flatMap((d) => fromLabeled(d.label, String(d.value), node.unit));
    case 'list':
      return node.items.flatMap((item) => readFigures(`${item.text} ${item.meta ?? ''}`));
    case 'timeline':
      return node.items.flatMap((item) => readFigures(`${item.when} ${item.title} ${item.text ?? ''}`));
    case 'steps':
      return node.items.flatMap((step) => readFigures(`${step.title} ${step.detail ?? ''}`));
    case 'scaler':
      return node.items.flatMap((item) => fromLabeled(item.name, String(item.amount), item.unit));
    case 'slider':
      return fromLabeled(node.label, String(node.value), node.unit);
    case 'progress':
      return fromLabeled(node.label, String(node.value));
    case 'rating':
      return fromLabeled(node.label ?? '', String(node.value));
    case 'accordion':
      return node.items.flatMap((item) => readFigures(`${item.title} ${item.text}`));
    case 'proscons':
      return [...node.pros, ...node.cons].flatMap((line) => readFigures(line));
    case 'badges':
      return node.items.flatMap((item) => readFigures(item));
    case 'reveal':
      return node.items.flatMap((item) => readFigures(`${item.front} ${item.back}`));
    case 'pricing':
      return node.plans.flatMap((plan) => plan.prices.flatMap((price) => (price.amount === undefined ? [] : fromLabeled(plan.name, String(price.amount), price.currency))));
    case 'divider':
    case 'actions':
    case 'citations':
    case 'slot':
    case 'image':
    case 'gallery':
    case 'links':
    case 'video':
    case 'code':
    case 'choices':
    case 'diagram':
    case 'ticker':
      return [];
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

export function figuresFromCard(card: AnswerCard): Figure[] {
  return dedupe(card.body.flatMap(figuresFromNode));
}

export function figuresFromSearch(search: LooseSearch): Figure[] {
  const texts = [
    search.knowledge?.extract ?? '',
    ...(search.results ?? []).slice(0, 8).map((row) => `${row.title ?? ''} ${row.snippet ?? ''} ${(row.content ?? '').slice(0, 400)}`),
  ];
  return dedupe(texts.flatMap((text) => readFigures(text))).slice(0, 12);
}

function operation(question: string): Op {
  const q = question.toLowerCase();
  if (/\bper\s+[a-z]/.test(q)) return 'rate';
  if (/\b(?:average|mean)\b/.test(q)) return 'average';
  if (/\b(?:difference|minus|subtract|how many more|how much more)\b/.test(q)) return 'difference';
  if (/\b(?:multiply|multiplied|product)\b/.test(q) || /\btimes\b/.test(q)) return 'product';
  if (/\b(?:divide|divided|ratio)\b/.test(q)) return 'ratio';
  if (/\b(?:add|sum|total|plus|combined|altogether)\b/.test(q)) return 'sum';
  return 'bare';
}

function orderByQuestion(question: string, figures: Figure[]): Figure[] {
  return figures
    .map((figure, index) => {
      let at = question.length + index;
      for (const name of aliases(figure)) {
        const found = question.toLowerCase().indexOf(name);
        if (found >= 0) at = Math.min(at, found);
      }
      return { figure, at, index };
    })
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((row) => row.figure);
}

function bareGroup(figures: Figure[]): Figure[] | undefined {
  const groups = new Map<string, Figure[]>();
  for (const figure of figures) {
    if (figure.clock || figure.rate) continue;
    const key = canonical(figure.unit || figure.label);
    if (!key || key === '%' || key === 'time') continue;
    const list = groups.get(key) ?? [];
    list.push(figure);
    groups.set(key, list);
  }
  let best: Figure[] | undefined;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    if (!best || list.length > best.length) best = list;
  }
  return best;
}

function ratePair(figures: Figure[]): { num: Figure; den: Figure } | undefined {
  const usable = figures.filter((figure) => !figure.clock && !figure.rate);
  if (usable.length !== 2) return undefined;
  const den = usable.find((figure) => DIVISORS.has(canonical(figure.unit || figure.label)));
  const num = usable.find((figure) => figure !== den);
  if (!den || !num) return undefined;
  if (canonical(num.unit || num.label) === canonical(den.unit || den.label)) return undefined;
  if (den.amount === 0) return undefined;
  return { num, den };
}

function phrase(f: Figure, question: string): string {
  if (f.clock) return f.display;
  const named = aliases(f).find((name) => name.length >= 3 && name !== f.unit.toLowerCase() && new RegExp(`\\b${escapeReg(name)}\\b`, 'i').test(question));
  const name = named ? prettyUnit(named) : f.label;
  if (f.unit === '$' || f.unit === '€' || f.unit === '£' || f.unit === '¥') return `${f.unit}${formatAmount(f.amount)}`;
  if (f.unit === '%') return `${formatAmount(f.amount)}%`;
  if (f.rate) return `${f.display} ${name}`;
  if (f.unit && canonical(f.unit) !== name.toLowerCase()) return `${formatAmount(f.amount)} ${name}`;
  return `${formatAmount(f.amount)} ${name}`;
}

function statLabel(f: Figure, question: string): string {
  const named = aliases(f).find((name) => name.length >= 3 && new RegExp(`\\b${escapeReg(name)}\\b`, 'i').test(question));
  if (named && named !== f.label.toLowerCase()) return prettyUnit(named);
  return f.label;
}

const OP_WORD: Record<Exclude<Op, 'bare' | 'rate'>, string> = {
  sum: '+',
  average: '+',
  difference: '−',
  product: '×',
  ratio: '/',
};

const SUBTITLE: Record<Op, string> = {
  sum: 'Total',
  average: 'Average',
  difference: 'Difference',
  product: 'Product',
  ratio: 'Ratio',
  rate: 'Rate',
  bare: 'Total',
};

function resultNodes(question: string, figures: Figure[], total: number, kind: Exclude<Op, 'bare' | 'rate'>, unit: string): CardNode[] {
  const sign = OP_WORD[kind];
  const parts = figures.map((figure) => phrase(figure, question));
  const result = unit === '$' || unit === '€' || unit === '£' || unit === '¥' ? `${unit}${formatAmount(total)}` : formatAmount(total);
  const worked = kind === 'average'
    ? `(${parts.join(' + ')}) / ${figures.length} = ${result}`
    : `${parts.join(` ${sign} `)} = ${result}`;
  const heroUnit = unit === '$' || unit === '%' || !unit || unit.length <= 2 ? undefined : prettyUnit(unit);
  const heroValue = unit === '$' || unit === '€' || unit === '£' || unit === '¥' ? `${unit}${formatAmount(total)}` : formatAmount(total);
  return [
    { type: 'hero', value: heroValue, unit: heroUnit, label: SUBTITLE[kind] },
    { type: 'text', text: worked, size: 'lg' },
    {
      type: 'grid',
      cols: 2,
      children: figures.map((figure) => ({
        type: 'stat' as const,
        label: statLabel(figure, question),
        value: figureValue(figure),
      })),
    },
  ];
}

function listNodes(figures: Figure[]): CardNode[] {
  if (!figures.length) {
    return [{ type: 'text', text: 'The card and its sources do not state figures to calculate.', size: 'lg' }];
  }
  return [
    { type: 'text', text: 'These figures use different measures, so they stay with the labels the source gave them.', size: 'lg' },
    {
      type: 'grid',
      cols: 2,
      children: figures.slice(0, 6).map((figure) => ({
        type: 'stat' as const,
        label: figure.label,
        value: figureValue(figure),
      })),
    },
  ];
}

function gather(question: string, card?: AnswerCard, search?: LooseSearch): Figure[] {
  const fromCard = card ? figuresFromCard(card) : [];
  const asked = Object.keys(ALIAS).filter((name) => new RegExp(`\\b${escapeReg(name)}\\b`, 'i').test(question));
  const missing = asked.some((name) => !fromCard.some((figure) => aliases(figure).includes(name)));
  if (fromCard.length >= 2 && !missing) return fromCard;
  if (fromCard.length >= 1 && fromCard.some((figure) => figureNamed(question, figure)) && !missing) return fromCard;
  const fromSources = search ? figuresFromSearch(search) : [];
  return dedupe([...fromCard, ...fromSources]);
}

function sharedUnit(figures: Figure[]): string {
  const units = new Set(figures.map((figure) => canonical(figure.unit || figure.label)));
  if (units.size === 1) return [...units][0]!;
  return '';
}

/** The calculation card. Figures come from the card on screen, then from that card's sources. */
export function calculationAnswer(input: {
  question: string;
  original: string;
  priorTitle?: string;
  card?: AnswerCard;
  search?: LooseSearch;
}): CalculationCard {
  const title = subjectTitle(input.original, input.priorTitle);
  const op = operation(input.question);
  const all = gather(input.question, input.card, input.search).filter((figure) => !figure.clock);
  const named = orderByQuestion(input.question, all.filter((figure) => figureNamed(input.question, figure)));

  const finish = (figures: Figure[], kind: Exclude<Op, 'bare' | 'rate'>): CalculationCard => ({
    title,
    subtitle: SUBTITLE[kind],
    nodes: resultNodes(input.question, figures, combine(kind, figures), kind, sharedUnit(figures)),
  });

  if (op === 'rate') {
    const per = input.question.match(/\bper\s+([a-z]+)/i)?.[1] ?? 'game';
    const den = all.find((figure) => !figure.rate && aliases(figure).some((name) => name.startsWith(per.replace(/s$/, '')) || per.startsWith(name.replace(/s$/, ''))));
    const num = (named.find((figure) => figure !== den) ?? all.find((figure) => figure !== den && !figure.rate));
    if (den && num && den.amount !== 0) {
      const total = num.amount / den.amount;
      const name = statLabel(num, input.question);
      return {
        title,
        subtitle: 'Rate',
        nodes: [
          { type: 'hero', value: formatAmount(total), label: `${name} per ${per}` },
          { type: 'text', text: `${phrase(num, input.question)} / ${phrase(den, input.question)} = ${formatAmount(total)} ${name.toLowerCase()} per ${per}`, size: 'lg' },
        ],
      };
    }
  }

  if ((op === 'sum' || op === 'average' || op === 'product') && named.length >= 2) return finish(named, op);
  if ((op === 'difference' || op === 'ratio') && named.length >= 2) {
    const pair = named.slice(0, 2);
    if (!(op === 'ratio' && pair[1]!.amount === 0)) return finish(pair, op);
  }

  const pool = named.length >= 2 ? named : all.filter((figure) => !figure.rate);
  const group = bareGroup(pool);
  if (group && (op === 'bare' || op === 'sum' || op === 'average' || op === 'product')) {
    const kind: Exclude<Op, 'bare' | 'rate'> = op === 'average' ? 'average' : op === 'product' ? 'product' : 'sum';
    return finish(group, kind);
  }

  const pair = (op === 'bare' || op === 'rate') ? ratePair(all) : undefined;
  if (pair) {
    const total = pair.num.amount / pair.den.amount;
    const name = statLabel(pair.num, input.question);
    const per = canonical(pair.den.unit || pair.den.label).replace(/s$/, '');
    return {
      title,
      subtitle: 'Rate',
      nodes: [
        { type: 'hero', value: formatAmount(total), label: `${name} per ${per}` },
        { type: 'text', text: `${phrase(pair.num, input.question)} / ${phrase(pair.den, input.question)} = ${formatAmount(total)} ${name.toLowerCase()} per ${per}`, size: 'lg' },
      ],
    };
  }

  return {
    title,
    subtitle: all.length ? 'Figures' : 'Calculated',
    nodes: listNodes(named.length ? named : all),
  };
}

function combine(kind: Exclude<Op, 'bare' | 'rate'>, figures: Figure[]): number {
  const amounts = figures.map((figure) => figure.amount);
  switch (kind) {
    case 'sum':
      return amounts.reduce((sum, n) => sum + n, 0);
    case 'average':
      return amounts.reduce((sum, n) => sum + n, 0) / amounts.length;
    case 'difference':
      return amounts[0]! - amounts[1]!;
    case 'product':
      return amounts.reduce((product, n) => product * n, 1);
    case 'ratio':
      return amounts[0]! / amounts[1]!;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
