import type { CardNode } from './card';

const NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept?', 'oct', 'nov', 'dec'];

/** "May" is also a verb: it names the month only beside a date, a year, or a word that dates it. */
const DATING = ['in', 'on', 'since', 'from', 'by', 'until', 'before', 'after', 'through', 'early', 'mid-?', 'late', 'of', 'last', 'next'];
const MAY_MONTH = new RegExp(`\\bMay\\s+\\d|\\b(?:${DATING.map((word) => `[${word[0]}${word[0]!.toUpperCase()}]${word.slice(1)}`).join('|')})\\s+May\\b`);

/** The months a source states, by name, by abbreviation next to a day, or in a numeric date. */
export function monthsIn(text: string): Set<number> {
  const out = new Set<number>();
  NAMES.forEach((name, month) => {
    if (month === 4 ? MAY_MONTH.test(text) : new RegExp(`\\b${name}\\b`, 'i').test(text)) out.add(month);
    else if (month !== 4 && new RegExp(`\\b${ABBR[month]}\\.?\\s+\\d{1,2}\\b`, 'i').test(text)) out.add(month);
  });
  for (const match of text.matchAll(/\b(?:19|20)\d{2}-(0[1-9]|1[0-2])-\d{2}\b/g)) out.add(Number(match[1]) - 1);
  for (const match of text.matchAll(/\b(1[0-2]|0?[1-9])\/\d{1,2}\/(?:19|20)?\d{2}\b/g)) out.add(Number(match[1]) - 1);
  return out;
}

/** A month the card writes next to a figure: "from May", "Before May revision", "Oct 16". */
const CLAIM = new RegExp(
  `(\\b(?:in|on|since|from|by|as of|effective|starting)\\s+)?(\\b(?:early|mid-?|late)\\s+)?\\b(${NAMES.map((name, i) => (i === 4 ? 'May' : `${name[0]!.toUpperCase()}${name.slice(1)}`)).join('|')}|(?:${ABBR.filter((_, i) => i !== 4).map((abbr) => `${abbr[0]!.toUpperCase()}${abbr.slice(1)}`).join('|')})\\.?(?=\\s+\\d))(\\s+\\d{1,2}(?:st|nd|rd|th)?\\b)?(,?\\s+(?:19|20)\\d{2}\\b)?`,
  'g',
);

function monthOf(word: string): number {
  const lower = word.toLowerCase().replace(/\.$/, '');
  const full = NAMES.indexOf(lower);
  return full >= 0 ? full : ABBR.findIndex((abbr) => new RegExp(`^${abbr}$`).test(lower));
}

/**
 * A text without the months its sources never state: "the revised US price from May, up from $449.99" becomes
 * "the revised US price, up from $449.99" when the cited page gives no month. A year that follows stays.
 */
export function withoutUnsourcedMonths(text: string, known: Set<number>): string {
  const next = text.replace(CLAIM, (whole, prep: string | undefined, part: string | undefined, word: string, day: string | undefined, year: string | undefined, at: number) => {
    if (word === 'May' && !prep && !part && !day && !year && !MAY_MONTH.test(text.slice(Math.max(0, at - 12), at + whole.length + 3))) return whole;
    const month = monthOf(word);
    if (month < 0 || known.has(month)) return whole;
    if (year) return `${prep ? 'in ' : ''}${year.replace(/^,?\s+/, '')}`;
    return '';
  });
  if (next === text) return text;
  return next.replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
}

/** Citation numbers anywhere in a component: "[3]" in its text and `source: 3` on a row. */
function citesIn(node: CardNode): number[] {
  const json = JSON.stringify(node);
  return [...new Set([...json.matchAll(/\[(\d{1,2})\]/g), ...json.matchAll(/"source":(\d{1,2})\b/g)].map((match) => Number(match[1])))];
}

export interface MonthSources {
  /** Each source's own text, by citation number minus one. */
  sources: readonly string[];
  /** What the person said and the card already showed: a month there is theirs, not invented. */
  asked: string;
  now: Date;
}

/** A component keeps only the months its cited sources (or the question, or today's date) state. */
export function withSourcedMonths(node: CardNode, ctx: MonthSources): CardNode {
  if (node.type === 'draft' || node.type === 'timeline') return node;
  const cites = citesIn(node).filter((n) => n >= 1 && n <= ctx.sources.length);
  const texts = cites.length ? cites.map((n) => ctx.sources[n - 1]!) : ctx.sources;
  const known = monthsIn(`${texts.join('\n')}\n${ctx.asked}`);
  known.add(ctx.now.getUTCMonth());
  return strip(node, known);
}

function strip(node: CardNode, known: Set<number>): CardNode {
  const fix = (text: string) => withoutUnsourcedMonths(text, known);
  const opt = (text: string | undefined) => (text === undefined ? undefined : fix(text));
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => strip(child, known));
      return children.every((child, i) => child === node.children[i]) ? node : ({ ...node, children } as CardNode);
    }
    case 'text':
    case 'callout': {
      const text = fix(node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const label = opt(node.label);
      const caption = opt(node.caption);
      return label === node.label && caption === node.caption ? node : { ...node, label, caption };
    }
    case 'tile': {
      const value = opt(node.value);
      const sub = opt(node.sub);
      return value === node.value && sub === node.sub ? node : { ...node, value, sub };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = fix(item.value);
        return value === item.value ? item : { ...item, value };
      });
      return items.every((item, i) => item === node.items[i]) ? node : { ...node, items };
    }
    case 'list': {
      const items = node.items.map((item) => {
        const text = fix(item.text);
        const meta = opt(item.meta);
        return text === item.text && meta === item.meta ? item : { ...item, text, meta };
      });
      return items.every((item, i) => item === node.items[i]) ? node : { ...node, items };
    }
    default:
      return node;
  }
}
