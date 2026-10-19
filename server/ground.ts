import type { AnswerCard, CardNode } from '../shared/card';
import { identifiersIn, joinSpacedDecimals, recordKey, withoutIdentifiers } from '../shared/text';

/** Numbers up to this value may appear without a source (counts, "step 1", etc.). */
const FREE_NUMBER_MAX = 2;

export function numberTokens(s: string): string[] {
  const joined = joinSpacedDecimals(s);
  return (joined.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

/** A DOI or an arXiv paper, the identifiers a card must take from its sources rather than write. */
const isRecord = (id: string) => /^10\.|doi\.org|arxiv/i.test(id);

const MONEY = /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars|euros|pounds)\b)/gi;

/** The amounts of money a line states, as number tokens. */
function moneyIn(text: string): string[] {
  return (text.match(MONEY) ?? []).flatMap((amount) => numberTokens(amount));
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const SCALED = /(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|mn?|million|bn?|billion|tn?|trillion)\b/gi;

export class Grounding {
  private readonly known: Set<string>;

  /** DOIs and arXiv papers the sources name, in their titles, text or links. */
  private readonly records: Set<string>;

  private readonly lenient: boolean;

  /** Even a lenient check drops a price nobody stated: set for an answer with no sources to take one from. */
  private readonly prices: boolean;

  /** `lenient` turns checks off, for answers that come from reasoning rather than sources. `links` are the source URLs. */
  constructor(corpus: string, lenient = false, links = '', prices = false) {
    this.prices = prices;
    this.known = new Set(numberTokens(corpus));
    // A figure rounded from the source's ("81,942" for 81,942.16, "4.3" for 4.33) is that figure. A whole number is
    // read as a rounding only from 1,000 up, so a small count never matches some unrelated decimal by chance.
    for (const token of [...this.known]) {
      const dot = token.indexOf('.');
      if (dot < 0) continue;
      const n = Number(token);
      if (!Number.isFinite(n)) continue;
      for (let places = token.length - dot - 2; places >= 1; places--) this.known.add(String(Number(n.toFixed(places))));
      if (Math.abs(n) >= 1000) this.known.add(String(Math.round(n)));
    }
    this.records = new Set(identifiersIn(`${corpus} ${links}`).filter(isRecord).map(recordKey));
    this.lenient = lenient;
  }

  ok(s: string | number | undefined): boolean {
    if (s === undefined) return true;
    // A reasoned answer may work out its own numbers, but a price is a fact about today: it comes from the
    // sources or the conversation, never from memory ("$299" for a tracker that sells for $179.99).
    if (this.lenient) return !this.prices || moneyIn(String(s)).every((n) => this.known.has(n));
    // A citation marker ("[11]") is a pointer to a source, not a figure.
    const text = String(s).replace(/\[\d+\]/g, ' ');
    // A paper's DOI is checked as a record the sources name. Its digits are not figures.
    if (!identifiersIn(text).filter(isRecord).every((id) => this.records.has(recordKey(id)))) return false;
    // "$80.5K" and "$1.65T" are 80,500 and 1,650,000,000,000 written short: either form in the sources backs them.
    const scaled = new Set<string>();
    for (const match of text.matchAll(SCALED)) {
      const n = Number(match[1]!.replace(/,/g, '')) * SCALE[match[2]!.toLowerCase()]!;
      if (this.known.has(String(Math.round(n))) || this.known.has(String(n))) scaled.add(numberTokens(match[1]!)[0]!);
    }
    return numberTokens(withoutIdentifiers(text)).every((n) => this.known.has(n) || scaled.has(n) || Number(n) <= FREE_NUMBER_MAX);
  }

  /** Keeps only sentences whose numbers are all backed by the sources. */
  sentences(text: string): string {
    // Join before the split. "reaching 1. 5°C" is one sentence; splitting it leaves "reaching 1." and drops the 5.
    const joined = joinSpacedDecimals(text);
    return joined
      .split(/(?<=[.!?])\s+(?!\d)/)
      .filter((s) => this.ok(s.replace(/\[\d+\]/g, '')))
      .join(' ');
  }
}

function groundNode(node: CardNode, g: Grounding): CardNode | undefined {
  const kids = (children: CardNode[]) => groundNodes(children, g);
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = kids(node.children);
      return children.length ? { ...node, children } : undefined;
    }
    case 'tabs': {
      const tabs = node.tabs.map((t) => ({ ...t, children: kids(t.children) })).filter((t) => t.children.length);
      return tabs.length ? { ...node, tabs } : undefined;
    }
    case 'divider':
    case 'badges':
    case 'image':
    case 'gallery':
    case 'actions':
    case 'citations':
    case 'slot':
    // Written output the person asked for, not claims about the world.
    case 'draft':
    case 'code':
    // Links point at search results by number, so there is nothing to verify beyond that.
    case 'links':
    case 'video':
      return node.type === 'badges' ? { ...node, items: node.items.filter((b) => g.ok(b)) } : node;
    case 'hero':
      return g.ok(node.value) ? { ...node, caption: node.caption && g.sentences(node.caption) } : undefined;
    case 'heading':
      return g.ok(node.text) ? node : undefined;
    case 'text': {
      const text = g.sentences(node.text);
      return text ? { ...node, text } : undefined;
    }
    case 'stat':
      return g.ok(node.value) && g.ok(node.delta) ? node : undefined;
    case 'tile':
      return g.ok(node.value) && g.ok(node.label) ? { ...node, sub: g.ok(node.sub) ? node.sub : undefined } : undefined;
    case 'keyvalue': {
      const items = node.items.filter((i) => g.ok(i.value));
      return items.length ? { ...node, items } : undefined;
    }
    case 'list': {
      const items = node.items.filter((i) => g.ok(i.text.replace(/\[\d+\]/g, '')) && g.ok(i.meta));
      return items.length ? { ...node, items } : undefined;
    }
    case 'chart': {
      const data = node.data.filter((d) => g.ok(d.value) && g.ok(d.label));
      return data.length >= 2 ? { ...node, data } : undefined;
    }
    case 'progress':
    case 'rating':
      return g.ok(node.value) ? node : undefined;
    case 'table': {
      // An unbacked cell is blanked, not the whole row: the row's other sourced cells still answer, and a lone
      // gap reads "—". A row whose label or every value is unbacked goes.
      const rows = node.rows
        .map((r) => (r.every((cell) => g.ok(cell)) ? r : r.map((cell, i) => (i === 0 || g.ok(cell) ? cell : ''))))
        .filter((r) => g.ok(r[0]) && (r.length < 2 || r.slice(1).some((cell) => cell.trim())));
      return rows.length ? { ...node, rows } : undefined;
    }
    case 'timeline': {
      const items = node.items.filter((i) => g.ok(i.when) && g.ok(i.title)).map((i) => ({ ...i, text: i.text && g.sentences(i.text) }));
      return items.length ? { ...node, items } : undefined;
    }
    case 'steps': {
      const items = node.items.filter((s) => g.ok(s.title)).map((s) => ({ ...s, detail: s.detail && g.sentences(s.detail) }));
      return items.length ? { ...node, items } : undefined;
    }
    case 'proscons': {
      const pros = node.pros.filter((p) => g.ok(p));
      const cons = node.cons.filter((c) => g.ok(c));
      return pros.length || cons.length ? { ...node, pros, cons } : undefined;
    }
    case 'quote':
      return g.ok(node.text) ? node : undefined;
    case 'callout': {
      const text = g.sentences(node.text);
      return text ? { ...node, text } : undefined;
    }
    case 'profile':
      return { ...node, facts: node.facts?.filter((f) => g.ok(f.value)) };
    case 'choices':
    case 'slider':
    case 'pricing':
    // Built from a quote feed by the server, not written by the model.
    case 'ticker':
    // Stages were checked against the sources before this node was kept.
    case 'diagram':
      return node;
    case 'scaler': {
      const items = node.items.filter((i) => g.ok(i.amount));
      return items.length && g.ok(node.base) ? { ...node, items } : undefined;
    }
    case 'accordion': {
      const items = node.items.map((i) => ({ ...i, text: g.sentences(i.text) })).filter((i) => i.text && g.ok(i.title));
      return items.length ? { ...node, items } : undefined;
    }
    case 'reveal': {
      const items = node.items.filter((i) => g.ok(i.front) && g.ok(i.back));
      return items.length ? { ...node, items } : undefined;
    }
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

export function groundNodes(nodes: CardNode[], g: Grounding): CardNode[] {
  return nodes.map((n) => groundNode(n, g)).filter((n): n is CardNode => !!n);
}

/** Removes any value the sources don't back up, so the card never shows invented numbers. */
export function groundCard(card: AnswerCard, corpus: string): { card: AnswerCard; removed: number } {
  const g = new Grounding(corpus);
  const count = (nodes: CardNode[]): number => nodes.reduce((n, node) => n + 1 + ('children' in node ? count(node.children) : 0), 0);
  const body = groundNodes(card.body, g);
  return { card: { ...card, subtitle: card.subtitle && g.ok(card.subtitle) ? card.subtitle : undefined, body }, removed: count(card.body) - count(body) };
}
