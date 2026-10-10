import type { CardNode } from './card';

/**
 * A bar only helps when the height is a magnitude: a ranking, a share, a trend.
 * A slate of games, a tip-off time, or a clock is a table. Long category names
 * use a horizontal bar so the axis does not cut them to six letters.
 */

const CLOCK_UNIT = /^(et|pt|ct|mt|gmt|utc|est|edt|pst|pdt|cst|cdt|bst|cet)$/i;
const CLOCK_WORDS = /\b(tip-?offs?|kick-?offs?|start times?|showtimes?|tee times?)\b/i;
const SLATE_WORDS = /\b(scores|box scores?|highlights|fixtures|slate)\b/i;
const KEEP_CHART = /\b(chart|graph|rank(?:ing|ings)?|most|highest|leader|per game|average|trend)\b/i;

export function undupeParen(title: string): string {
  return title.replace(/(\s*\([^)]+\))\1+/g, '$1').trim();
}

export function unitAlreadyInTitle(title: string | undefined, unit: string | undefined): boolean {
  if (!title || !unit?.trim()) return false;
  const u = unit.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\(\\s*${u}\\s*\\)`, 'i').test(title);
}

function cleanTitle(title: string | undefined, unit: string | undefined): string | undefined {
  if (!title) return undefined;
  let text = undupeParen(title);
  if (unitAlreadyInTitle(text, unit)) {
    const u = unit!.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\s*\\(\\s*${u}\\s*\\)`, 'gi'), ' ').replace(/\s{2,}/g, ' ').trim();
  }
  return text || undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHours(hours: number): string {
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60) % 60;
  const h24 = ((whole % 24) + 24) % 24;
  const h12 = h24 % 12 || 12;
  const ap = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${pad(mins)} ${ap}`;
}

/** Hours of a day, minutes from noon onward, or HHMM. Undefined when the numbers are not a clock. */
function clockText(values: number[]): ((n: number) => string) | undefined {
  if (values.every((v) => v >= 0 && v <= 24) && values.some((v) => v >= 12 || !Number.isInteger(v))) return formatHours;
  if (values.every((v) => v >= 12 * 60 && v <= 24 * 60)) return (n) => formatHours(n / 60);
  if (values.every((v) => Number.isInteger(v) && v >= 100 && v <= 2359 && v % 100 < 60)) {
    return (n) => formatHours(Math.floor(n / 100) + (n % 100) / 60);
  }
  return undefined;
}

function isClock(node: Extract<CardNode, { type: 'chart' }>, query: string): boolean {
  if (CLOCK_UNIT.test(node.unit ?? '')) return true;
  return CLOCK_WORDS.test(`${node.title ?? ''} ${query}`);
}

function isScoreboard(node: Extract<CardNode, { type: 'chart' }>, query: string): boolean {
  if (node.kind === 'line' || node.kind === 'area') return false;
  if (KEEP_CHART.test(query)) return false;
  if (SLATE_WORDS.test(`${query} ${node.title ?? ''}`)) return true;
  const matchups = node.data.filter((d) => /\s(?:@|vs\.?|versus)\b|@$/i.test(d.label)).length;
  return matchups >= 2;
}

function asTable(node: Extract<CardNode, { type: 'chart' }>, columns: [string, string], cell: (value: number) => string): CardNode {
  const title = cleanTitle(node.title, node.unit);
  const table: CardNode = {
    type: 'table',
    columns,
    rows: node.data.map((d) => [d.label, cell(d.value)]),
  };
  return title ? { type: 'section', title, children: [table] } : table;
}

function fitChart(node: Extract<CardNode, { type: 'chart' }>, query: string): CardNode {
  const title = cleanTitle(node.title, node.unit);
  if (isClock(node, query)) {
    const clock = clockText(node.data.map((d) => d.value));
    const valueHeader = node.unit ? `Time (${node.unit})` : 'Time';
    return asTable({ ...node, title }, ['Game', valueHeader], (value) => (clock ? clock(value) : String(value)));
  }
  if (isScoreboard(node, query)) {
    const valueHeader = node.unit && !/^points?$/i.test(node.unit) ? node.unit : 'Points';
    return asTable({ ...node, title }, ['Team', valueHeader], (value) => String(value));
  }
  const kind = node.kind === 'bar' && node.data.some((d) => d.label.length > 6) ? 'hbar' : node.kind;
  return { ...node, kind, title, unit: node.unit };
}

export function fitNode(node: CardNode, query: string): CardNode {
  if (node.type === 'tabs') {
    return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => fitNode(child, query)) })) };
  }
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    return { ...node, children: node.children.map((child) => fitNode(child, query)) };
  }
  if (node.type === 'chart') return fitChart(node, query);
  return node;
}
