import type { AnswerCard, CardNode } from '../shared/card';

/** Numbers up to this value may appear without a source (counts, "step 1", etc.). */
const FREE_NUMBER_MAX = 2;

export function numberTokens(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

const MARKER = /\[(\d+)\]/g;

/** `arr[1]` in code is not a citation; tickers and diagrams are built from their own data. */
const UNCITED = new Set(['code', 'draft', 'ticker', 'diagram']);

/** Numbers that must be on the cited page: counts like "step 1" are not claims. */
const claimNumbers = (s: string) => [...new Set(numberTokens(s.replace(MARKER, '')).filter((n) => Number(n) > FREE_NUMBER_MAX))];

/**
 * The numbers each source states, by source number. A number is often in the sources but not
 * on the page its citation points at; the citation is moved to the page that states it.
 */
export class SourceNumbers {
  private readonly bySource = new Map<number, Set<string>>();

  constructor(sources: { n: number; text: string }[]) {
    for (const { n, text } of sources) {
      const own = this.bySource.get(n) ?? new Set<string>();
      for (const t of numberTokens(text)) own.add(t);
      this.bySource.set(n, own);
    }
  }

  private states(n: number, num: string): boolean {
    return this.bySource.get(n)?.has(num) ?? false;
  }

  /** The fewest other sources (at most 2) that state `nums`, or undefined when no such pair exists. */
  private cover(nums: string[], skip: ReadonlySet<number>): number[] | undefined {
    const added: number[] = [];
    let left = nums;
    while (left.length && added.length < 2) {
      let best: { n: number; hits: number } | undefined;
      for (const [n, own] of this.bySource) {
        if (skip.has(n) || added.includes(n)) continue;
        const hits = left.filter((x) => own.has(x)).length;
        if (hits && (!best || hits > best.hits || (hits === best.hits && n < best.n))) best = { n, hits };
      }
      if (!best) return undefined;
      added.push(best.n);
      left = left.filter((x) => !this.states(best!.n, x));
    }
    return left.length ? undefined : added;
  }

  /** One cited sentence: a citation whose page states none of its numbers gives way to pages that state them all. */
  private sentence(s: string): string {
    const cited = [...new Set([...s.matchAll(MARKER)].map((m) => Number(m[1])))];
    if (!cited.length) return s;
    const nums = claimNumbers(s);
    const missing = nums.filter((x) => !cited.some((n) => this.states(n, x)));
    if (!missing.length) return s;
    const added = this.cover(missing, new Set(cited));
    if (!added) return s;
    // A citation stays when it states a number the new pages don't ("17" in "iPhone 17" is on every page).
    const keep = cited.filter((n) => nums.some((x) => this.states(n, x) && !added.some((a) => this.states(a, x))));
    const refs = [...keep, ...added].sort((a, b) => a - b).map((n) => `[${n}]`).join('');
    // The markers go where the last one stood, so the sentence reads the same.
    const last = [...s.matchAll(MARKER)].pop()!;
    const strip = (t: string) => t.replace(/\s*\[\d+\]/g, '');
    const head = strip(s.slice(0, last.index)).trimEnd();
    const tail = strip(s.slice(last.index! + last[0].length));
    return `${head}${/\s\[\d+\]/.test(s) ? ' ' : ''}${refs}${tail}`;
  }

  text(s: string): string {
    if (!/\[\d+\]/.test(s)) return s;
    return s.split(/(?<=[.!?])(\s+)/).map((part) => (/^\s+$/.test(part) ? part : this.sentence(part))).join('');
  }

  /** A row linked to a page that misses some of its numbers links to the one page that states them all. */
  source(n: number | undefined, ...texts: (string | undefined)[]): number | undefined {
    if (n === undefined) return n;
    const nums = claimNumbers(texts.filter(Boolean).join(' '));
    if (nums.every((x) => this.states(n, x))) return n;
    const [only, ...rest] = this.cover(nums, new Set([n])) ?? [];
    return only !== undefined && !rest.length ? only : n;
  }

  /** Every cited string in a node, at any depth, plus the source links of tiles and list rows. */
  node(node: CardNode): CardNode {
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') return this.text(value);
      if (Array.isArray(value)) return value.map(walk);
      if (!value || typeof value !== 'object') return value;
      if (UNCITED.has(String((value as { type?: unknown }).type))) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return this.links(out as CardNode);
    };
    return walk(node) as CardNode;
  }

  private links(node: CardNode): CardNode {
    if (node.type === 'tile' && node.source !== undefined) return { ...node, source: this.source(node.source, node.value, node.sub) };
    if (node.type === 'list') return { ...node, items: node.items.map((i) => (i.source === undefined ? i : { ...i, source: this.source(i.source, i.text) })) };
    return node;
  }
}

export class Grounding {
  private readonly known: Set<string>;

  private readonly lenient: boolean;

  private readonly cites?: SourceNumbers;

  /** `lenient` turns checks off, for answers that come from reasoning rather than sources. */
  constructor(corpus: string, lenient = false, cites?: SourceNumbers) {
    this.known = new Set(numberTokens(corpus));
    this.lenient = lenient;
    this.cites = cites;
  }

  /** Points each cited number at a page that states it. */
  recite(node: CardNode): CardNode {
    return this.cites ? this.cites.node(node) : node;
  }

  ok(s: string | number | undefined): boolean {
    if (s === undefined || this.lenient) return true;
    return numberTokens(String(s)).every((n) => this.known.has(n) || Number(n) <= FREE_NUMBER_MAX);
  }

  /** Keeps only sentences whose numbers are all backed by the sources. */
  sentences(text: string): string {
    return text
      .split(/(?<=[.!?])\s+/)
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
      const rows = node.rows.filter((r) => r.every((cell) => g.ok(cell)));
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
