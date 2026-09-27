import type { AnswerCard, CardNode } from '../shared/card';

/** Numbers up to this value may appear without a source (counts, "step 1", etc.). */
const FREE_NUMBER_MAX = 2;

export function numberTokens(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

export class Grounding {
  private readonly known: Set<string>;

  constructor(corpus: string) {
    this.known = new Set(numberTokens(corpus));
  }

  ok(s: string | number | undefined): boolean {
    if (s === undefined) return true;
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
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function groundNodes(nodes: CardNode[], g: Grounding): CardNode[] {
  return nodes.map((n) => groundNode(n, g)).filter((n): n is CardNode => !!n);
}

/** Removes any value the sources don't back up, so the card never shows invented numbers. */
export function groundCard(card: AnswerCard, corpus: string): { card: AnswerCard; removed: number } {
  const g = new Grounding(corpus);
  const count = (nodes: CardNode[]): number => nodes.reduce((n, node) => n + 1 + ('children' in node ? count(node.children) : 0), 0);
  const body = groundNodes(card.body, g);
  return { card: { ...card, subtitle: card.subtitle && g.ok(card.subtitle) ? card.subtitle : undefined, body }, removed: count(card.body) - count(body) };
}
