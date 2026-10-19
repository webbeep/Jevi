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
  rebounds: ['rpg', 'rebound', 'rebounds', 'reb'],
  assists: ['apg', 'assist', 'assists', 'ast'],
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

const RATE_ASK = /\b(?:tax|taxes)\b|\bwhat if\b[^?]{0,80}\$\s?\d/i;
const ASKED_MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)/;

/** A follow-up that applies a rate already on the card to a new amount. Undefined when the rate is not on the card. */
export function rateOnAmount(input: {
  question: string;
  original: string;
  priorTitle?: string;
  card?: AnswerCard;
  search?: LooseSearch;
}): CalculationCard | undefined {
  const question = input.question.trim();
  if (!RATE_ASK.test(question)) return undefined;
  const money = question.match(ASKED_MONEY);
  if (!money) return undefined;
  const base = Number(money[1]!.replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const blob = [
    JSON.stringify(input.card?.body ?? []),
    input.card?.title ?? '',
    ...(input.search?.results ?? []).slice(0, 8).map((row) => `${row.title ?? ''} ${row.snippet ?? ''}`),
  ].join('\n');
  const rates = [...blob.matchAll(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent)/gi)]
    .map((match) => Number(match[1]))
    .filter((rate) => rate > 0 && rate < 40);
  const unique = [...new Set(rates.map((rate) => rate.toFixed(3)))].map(Number);
  if (!unique.length) return undefined;
  const labeled = blob.match(/(?:combined|total|overall)[^%]{0,32}(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%[^.\n]{0,32}(?:combined|total|overall)/i);
  const labeledRate = Number(labeled?.[1] ?? labeled?.[2]);
  const summed = unique.find((rate) => {
    const others = unique.filter((item) => item !== rate);
    const sum = others.reduce((total, item) => total + item, 0);
    return others.length >= 2 && Math.abs(sum - rate) < 0.02;
  });
  const rate = Number.isFinite(labeledRate) && labeledRate > 0 ? labeledRate : summed ?? (unique.length === 1 ? unique[0] : undefined);
  if (rate === undefined) return undefined;
  const due = Math.round(base * rate * 100) / 10000;
  const dollars = due.toFixed(2);
  return {
    title: `Tax $${dollars}`,
    subtitle: 'From the rate already on the card',
    nodes: [
      { type: 'hero', value: `$${dollars}`, label: 'Tax' },
      { type: 'text', text: `$${base} × ${rate}% is $${dollars}.`, size: 'lg' },
    ],
  };
}

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
const LEAD_RE = /\b(points|point|pts|rebounds|rebound|reb|assists|assist|ast|steals|steal|blocks|block|games|game|minutes|minute|hours|hour|dollars|dollar|calories|kcal|people|cups|cup|kg|lb|lbs)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)(?!\s*(?:%|percent|kg|lb|lbs|pounds|minutes|minute|hours|hour|points|point|games|game))/gi;
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
  if (['point', 'points', 'pts', 'ppg'].includes(u)) return 'points';
  if (['rebound', 'rebounds', 'reb', 'rpg'].includes(u)) return 'rebounds';
  if (['assist', 'assists', 'ast', 'apg'].includes(u)) return 'assists';
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

function isMeasure(label: string): boolean {
  const text = label.trim();
  if (!text || text.length > 40 || /\d/.test(text)) return false;
  if (LABEL_WORD.test(text) || /^weigh(?:s|ing)?$/i.test(text)) return true;
  if (/^(?:PPG|RPG|APG|SPG|BPG|MPG|FG%|FT%|3P%|PTS|REB|AST)$/i.test(text)) return true;
  return Object.values(ALIAS).some((words) => words.some((word) => new RegExp(`\\b${escapeReg(word)}\\b`, 'i').test(text)));
}

function fromLabeled(label: string, value: string, unit?: string): Figure[] {
  const blob = [label, value, unit].filter(Boolean).join(' ');
  const parsed = readFigures(blob);
  const header = label.trim();
  const words = header.split(/\s+/).filter(Boolean);
  if (parsed.length > 1 || words.length > 6 || header.length > 48 || /\d/.test(header)) return parsed;
  if (parsed.length === 1) {
    if (!isMeasure(header)) return parsed;
    const pretty = /^weigh(?:s|ing)?$/i.test(header) ? 'Weight' : header;
    return [{ ...parsed[0]!, label: pretty || parsed[0]!.label }];
  }
  if (!isMeasure(header) && !unit) return [];
  const bare = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!bare || words.length === 0 || words.length > 4) return [];
  const amount = parseAmount(bare[0]!);
  if (!Number.isFinite(amount)) return [];
  if (!unit && bare[0]!.replace(/,/g, '').length === 4 && amount >= 1800 && amount <= 2099) return [];
  const abbr = /^(?:PPG|RPG|APG|SPG|BPG|MPG|FG%|FT%|3P%)$/i.test(header);
  return [{
    label: header,
    unit: canonical(unit || header),
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
      return node.rows.flatMap((row) => row.flatMap((cell, i) => {
        const column = node.columns[i] ?? '';
        const lead = row[0] ?? '';
        if (i === 0 && !/\d/.test(cell)) return [];
        const measure = [lead, column].find((part) => isMeasure(part)) ?? '';
        const item = [column, lead].find((part) => part && part !== measure && !isMeasure(part) && !/\d/.test(part)) ?? '';
        const parsed = fromLabeled(measure || column || lead, cell);
        if (!item || parsed.length !== 1) return parsed;
        return [{ ...parsed[0]!, label: `${item} ${parsed[0]!.label}`.replace(/\s+/g, ' ') }];
      }));
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

function structuredFigures(node: CardNode): Figure[] {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return node.children.flatMap(structuredFigures);
    case 'tabs':
      return node.tabs.flatMap((tab) => tab.children.flatMap(structuredFigures));
    case 'hero':
    case 'stat':
    case 'tile':
    case 'keyvalue':
    case 'profile':
    case 'table':
    case 'chart':
    case 'scaler':
    case 'slider':
      return figuresFromNode(node);
    case 'heading':
    case 'text':
    case 'quote':
    case 'draft':
    case 'callout':
    case 'list':
    case 'timeline':
    case 'steps':
    case 'progress':
    case 'rating':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'reveal':
    case 'pricing':
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
  const structured = dedupe(card.body.flatMap(structuredFigures));
  if (structured.length >= 2) return structured;
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

/** One key per measure. Currency stays together; points do not merge with rebounds. */
function measureKey(figure: Figure): string {
  const names = aliases(figure);
  const specific = Object.keys(ALIAS).find((name) => name !== 'dollars' && names.includes(name));
  if (specific) return specific;
  const unit = canonical(figure.unit || '');
  if (unit === '$' || unit === '€' || unit === '£' || unit === '¥') return unit;
  return unit || figure.label.toLowerCase();
}

function groupKey(figure: Figure): string {
  const unit = canonical(figure.unit || '');
  if (unit === '$' || unit === '€' || unit === '£' || unit === '¥') return unit;
  return measureKey(figure);
}

/** The first figure of each measure, in card order. A later season line does not get added again. */
function firstOfEach(figures: Figure[]): Figure[] {
  const seen = new Set<string>();
  const out: Figure[] = [];
  for (const figure of figures) {
    const key = measureKey(figure);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(figure);
  }
  return out;
}

function bareGroup(figures: Figure[], hint: string): Figure[] | undefined {
  const groups = new Map<string, Figure[]>();
  for (const figure of figures) {
    if (figure.clock || figure.rate) continue;
    const key = groupKey(figure);
    if (!key || key === '%' || key === 'time') continue;
    const list = groups.get(key) ?? [];
    list.push(figure);
    groups.set(key, list);
  }
  let best: Figure[] | undefined;
  let bestScore = -1;
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const hinted = new RegExp(`\\b${escapeReg(key)}\\b`, 'i').test(hint) ? 2 : 0;
    const score = hinted * 100 + list.length;
    if (score > bestScore) {
      best = list;
      bestScore = score;
    }
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
  const every = /\b(?:each|every|all of them|both the)\b/i.test(input.question);
  const named = orderByQuestion(input.question, every
    ? all.filter((figure) => figureNamed(input.question, figure))
    : firstOfEach(all.filter((figure) => figureNamed(input.question, figure))));

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
  const group = bareGroup(pool, `${input.original} ${input.priorTitle ?? ''} ${input.question}`);
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

/** Every labeled figure on a card: hero, stat, tile, key-value row and table row, with the label beside it. */
function labeledFigures(nodes: readonly CardNode[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const walk = (node: CardNode) => {
    switch (node.type) {
      // A stat or hero keeps its unit apart ("8.875" with unit "%"): read together, or the rate is missed.
      case 'hero':
        out.push({ label: `${node.label ?? ''} ${node.caption ?? ''}`, value: `${node.value}${node.unit ?? ''}` });
        return;
      case 'stat':
        out.push({ label: node.label, value: `${node.value}${node.unit ?? ''}` });
        return;
      case 'tile':
        out.push({ label: `${node.label} ${node.sub ?? ''}`, value: node.value ?? '' });
        return;
      case 'keyvalue':
        for (const item of node.items) out.push({ label: item.label, value: item.value });
        return;
      case 'table':
        for (const row of node.rows) out.push({ label: row[0] ?? '', value: row.slice(1).join(' ') });
        return;
      case 'tabs':
        node.tabs.forEach((tab) => tab.children.forEach(walk));
        return;
      case 'text':
      case 'callout':
        // "A sale shipped to New York City requires 8.875%": a rate stated in a sentence is still the card's rate.
        // Only the rate is read from prose; a price in a sentence is not a labeled figure.
        for (const sentence of node.text.split(/(?<=[.!?])\s+/)) {
          if (!/\b(?:tax|rate)\b/i.test(sentence)) continue;
          const rates = [...sentence.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((m) => `${m[1]}%`);
          if (rates.length) out.push({ label: 'tax rate', value: rates.join(' ') });
        }
        return;
      default:
        if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return out;
}

const dollarsIn = (text: string): number | undefined => {
  const match = text.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  const value = match ? Number(match[1]!.replace(/,/g, '')) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
};
const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The price, the sales-tax rate and any taxed total a card states. The rate is the most precise one
 * on the card: "8.875%" wins over "almost 9%", which is a rounding of it.
 */
export function cardPriceAndTax(nodes: readonly CardNode[]): { price?: number; rate?: number; total?: number } {
  const figures = labeledFigures(nodes);
  const total = figures.find((f) => /\btotal\b|\bwith tax\b|\bafter tax\b|\bout the door\b/i.test(f.label) && !/\bsplit|each|per\b/i.test(f.label));
  const price = figures.find((f) => /\b(?:price|cost|msrp|retail|list)\b/i.test(f.label) && !/\btax|total|fee|split|each\b/i.test(f.label) && dollarsIn(f.value) !== undefined)
    ?? figures.find((f) => !/\btax|total|fee|split|each|%/i.test(`${f.label} ${f.value}`) && dollarsIn(f.value) !== undefined);
  // "NYC combined sales tax 8.875%" and "Combined NYC rate 8.875%" are both the rate. Of several, the most precise
  // wins ("8.875%" over "almost 9%"), then the largest: the combined rate, not its 0.375% surcharge.
  // A fee, interest or discount percentage is not the sales tax.
  const PART = /\b(?:city|state|county|local|mctd|mta|metropolitan|surcharge|district|special|transit|municipal)\b/i;
  const rateRows = figures.filter((f) => (/\b(?:tax|rate)\b/i.test(f.label) || /\btax\b/i.test(f.value) || (PART.test(f.label) && /%/.test(f.value)))
    && !/\b(?:fee|fees|interest|apr|discount|tip|commission)\b/i.test(f.label));
  const ratesOf = (rows: typeof figures) => rows
    .flatMap((f) => [...`${f.value} ${f.label}`.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((m) => m[1]!))
    .filter((raw) => Number(raw) > 0 && Number(raw) < 15)
    .sort((a, b) => (b.split('.')[1]?.length ?? 0) - (a.split('.')[1]?.length ?? 0) || Number(b) - Number(a));
  // A rate the card labels combined or total is the rate; a part ("MCTD surcharge 0.375%") never stands in for it.
  const combined = ratesOf(rateRows.filter((f) => /\b(?:combined|total|overall)\b/i.test(f.label)));
  // Without a combined rate, the parts of one ("City 4.5% · State 4% · MCTD 0.375%") add up to it; one part alone is
  // never the rate. A rate row that names no part (a single "Sales tax 6.25%") is used as is.
  const parts = rateRows.filter((f) => PART.test(f.label));
  const whole = ratesOf(rateRows.filter((f) => !PART.test(f.label)));
  const partRates = [...new Set(parts.map((f) => ratesOf([f])[0]).filter((rate): rate is string => !!rate))];
  const summed = partRates.length >= 2 ? [String(Math.round(partRates.reduce((sum, rate) => sum + Number(rate), 0) * 1000) / 1000)] : [];
  // A lone state, city or county rate is the rate asked; a lone surcharge (MCTD, MTA, district) is only an add-on.
  const lone = partRates.length === 1 && !parts.some((f) => /\b(?:surcharge|mctd|mta|metropolitan|district|special|transit)\b/i.test(f.label)) ? partRates : [];
  const rates = combined.length ? combined : whole.length ? whole : summed.length ? summed : lone;
  return { price: price && dollarsIn(price.value), rate: rates[0] ? Number(rates[0]) : undefined, total: total && dollarsIn(total.value) };
}

const PEOPLE: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, both: 2 };
const SPLIT_ASK = /\bsplit\b|\beach of us\b|\bper person\b|\bdivide(?:d)?\b[^?]{0,20}\b(?:between|among|by)\b|\bshare (?:it|the cost)\b/i;

/** How many people share: "my brother and I" is two, "three ways" is three. Undefined when the question does not say. */
export function splitCount(question: string): number | undefined {
  const q = question.toLowerCase();
  const ways = q.match(/\b(two|three|four|five|six|\d)\s+ways\b/) ?? q.match(/\b(?:between|among)\s+(two|three|four|five|six|\d)\b/) ?? q.match(/\bthe\s+(two|three|four|five|six|\d)\s+of us\b/);
  if (ways) return PEOPLE[ways[1]!] ?? Number(ways[1]);
  const named = q.match(/\b(?:my|our)\s+[a-z]+(?:\s+and\s+(?:my|our)\s+[a-z]+)*\s+and\s+(?:i|me)\b/);
  if (named) return named[0].split(/\s+and\s+/).length;
  if (/\bboth of us\b|\bthe two of us\b/.test(q)) return 2;
  return undefined;
}

/** "If my brother and I split it, how much does each of us pay?" — the card's total, divided. Undefined when the card has no amount. */
export function splitShare(input: { question: string; card?: AnswerCard; earlier?: readonly AnswerCard[] }): CalculationCard | undefined {
  if (!SPLIT_ASK.test(input.question) || !input.card) return undefined;
  const people = splitCount(input.question);
  if (!people || people < 2) return undefined;
  const own = cardPriceAndTax(input.card.body);
  // A card that shows only the tax rate splits the price the card before it stated, taxed at that rate.
  const price = own.price ?? (own.total === undefined
    ? (input.earlier ?? []).map((card) => cardPriceAndTax(card.body).price).find((value) => value !== undefined)
    : undefined);
  const { rate, total } = own;
  const taxed = total ?? (price !== undefined && rate !== undefined ? Math.round(price * (1 + rate / 100) * 100) / 100 : undefined);
  const amount = taxed ?? price;
  if (amount === undefined) return undefined;
  const each = Math.round((amount / people) * 100) / 100;
  const how = total !== undefined
    ? `${money(total)} total`
    : taxed !== undefined && price !== undefined && rate !== undefined
      ? `${money(price)} + ${rate}% sales tax = ${money(taxed)}`
      : `${money(amount)}`;
  const subject = input.card.title.replace(/\b(?:price|cost)s?\b.*$/i, '').trim() || input.card.title;
  return {
    title: `${subject} split ${people} ways`.replace(/\s+/g, ' '),
    subtitle: 'From the figures already on the card',
    nodes: [
      { type: 'hero', value: `${money(each)} each`, label: `Split ${people} ways` },
      { type: 'text', text: `${how}, divided by ${people}, is ${money(each)} each.`, size: 'lg' },
      { type: 'grid', cols: 3, children: [
        { type: 'stat', label: 'Total', value: money(amount) },
        { type: 'stat', label: 'People', value: String(people) },
        { type: 'stat', label: 'Each pays', value: money(each) },
      ] },
    ],
  };
}

const TAX_TOTAL_ASK = /\b(?:with|after|including|plus|incl\.?)\b[^?]{0,30}\btax(?:es)?\b|\bsales tax\b[^?]{0,40}\b(?:pay|cost|total)\b|\b(?:pay|cost|total)\b[^?]{0,40}\bsales tax\b/i;

/**
 * "What would I pay with sales tax in NYC?" is answered by the taxed total. When the card states a price
 * and the tax rate but no total, the lead becomes that total, worked from the most precise rate on the card.
 * Undefined when the question is not that ask, a figure is missing, or the card already shows the total.
 */
export function leadTaxedTotal(
  question: string,
  nodes: readonly CardNode[],
  fallback: { priorNodes?: readonly CardNode[]; officialRate?: number } = {},
): CardNode[] | undefined {
  if (!TAX_TOTAL_ASK.test(question)) return undefined;
  const own = cardPriceAndTax(nodes);
  // "What would I pay with sales tax in NYC?" under the $499.99 card: a new card that states only the rate still
  // prices the thing on the card before it, and a card that states only the price takes the official page's rate.
  // A price the card before called the old one ("up from $449.99") is not the price now.
  const prior = fallback.priorNodes ? cardPriceAndTax(fallback.priorNodes).price : undefined;
  const price = own.price !== undefined && prior !== undefined && own.price !== prior && calledOld(own.price, fallback.priorNodes ?? [])
    ? prior
    : own.price ?? prior;
  const rate = own.rate ?? fallback.officialRate;
  const { total } = own;
  if (price === undefined || rate === undefined) return undefined;
  const taxed = Math.round(price * (1 + rate / 100) * 100) / 100;
  if (total !== undefined && Math.abs(total - taxed) <= 0.02) return undefined;
  const tax = Math.round((taxed - price) * 100) / 100;
  const hero: CardNode = { type: 'hero', value: money(taxed), label: 'Total with sales tax', caption: `${money(price)} + ${rate}% tax (${money(tax)})` };
  let placed = false;
  const swap = (node: CardNode): CardNode => {
    if (placed) return node;
    if (node.type === 'hero') {
      placed = true;
      return hero;
    }
    if ((node.type === 'stack' || node.type === 'grid' || node.type === 'section') && node.children.some((child) => child.type === 'hero')) {
      return { ...node, children: node.children.map(swap) };
    }
    return node;
  };
  // A line saying the rate or the total can't be found is wrong once the card works the total out.
  const kept = nodes.map((node) => withoutTotalDenial(node) ?? { type: 'stack', children: [] } as CardNode);
  const next = kept.map(swap);
  if (placed) return next;
  return kept.length ? [{ type: 'stack', direction: 'col', gap: 'md', children: [hero, kept[0]!] }, ...kept.slice(1)] : [hero];
}

/** The card names this amount as a past price: "Up from $449.99", "was $449.99", "Previous MSRP $449.99". */
function calledOld(amount: number, nodes: readonly CardNode[]): boolean {
  const text = JSON.stringify(nodes);
  const figure = money(amount).replace('$', '\\$').replace('.', '\\.');
  return new RegExp(`(?:up from|raised from|increased from|was|previous(?:ly)?|prior|old|before|from)[^"]{0,24}${figure}|(?:previous|prior|old|former)[^"]{0,30}"[^"]*"[^"]{0,20}${figure}`, 'i').test(text);
}

const TOTAL_DENIAL = /\b(?:don['’]t|do not|doesn['’]t|does not|can['’]t|cannot|no)\b[^.]{0,80}\b(?:tax(?:-inclusive)?|rate|total)\b|\b(?:tax|rate|total)\b[^.]{0,60}\b(?:not (?:stated|given|listed|found|in (?:the |these )?sources)|can['’]t be (?:confirmed|calculated))/i;

function withoutTotalDenial(node: CardNode): CardNode | undefined {
  if (node.type === 'callout' || node.type === 'text') return TOTAL_DENIAL.test(node.text) ? undefined : node;
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section') {
    const children = node.children.map(withoutTotalDenial).filter((child): child is CardNode => !!child);
    if (children.length === node.children.length) return node;
    return children.length ? { ...node, children } : undefined;
  }
  return node;
}
