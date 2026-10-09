import type { CardNode } from './card';

/** Talk about a chart, image or price series being unavailable — false on a card that opens with the live chart. */
export const CHART_TALK = /\b(chart|graph|image|picture|photo|price (?:data|history|series)|historical (?:data|prices))\b/i;
const UNAVAILABLE = /\b(no|not|unavailable|missing|isn'?t|aren'?t|couldn'?t|can'?t|cannot|without|lack)\b/i;

export const saysChartMissing = (text: string) => CHART_TALK.test(text) && UNAVAILABLE.test(text);

/**
 * Next to a ticker: a model-drawn chart only repeats the price, worse, and a note that a chart is missing is wrong.
 * Used on the server before a node is sent, and in the client for cards saved before that check existed.
 */
export function withoutCharts(node: CardNode | undefined): CardNode | undefined {
  if (!node || node.type === 'chart') return undefined;
  if ((node.type === 'callout' || node.type === 'text') && saysChartMissing(`${node.type === 'callout' ? node.title ?? '' : ''} ${node.text}`)) return undefined;
  if (node.type === 'tabs') {
    const tabs = node.tabs.map((t) => ({ ...t, children: t.children.map(withoutCharts).filter((c): c is CardNode => !!c) })).filter((t) => t.children.length);
    return tabs.length ? { ...node, tabs } : undefined;
  }
  if ('children' in node) {
    const children = node.children.map(withoutCharts).filter((c): c is CardNode => !!c);
    return children.length ? ({ ...node, children } as CardNode) : undefined;
  }
  return node;
}

const hasTicker = (nodes: CardNode[]): boolean =>
  nodes.some((n) => n.type === 'ticker' || ('children' in n && hasTicker(n.children)));

/** A card body with the ticker kept and everything that contradicts it removed. */
export function tickerBody(body: CardNode[]): CardNode[] {
  if (!hasTicker(body)) return body;
  const keep = (n: CardNode): CardNode | undefined => {
    if (n.type === 'ticker') return n;
    if ('children' in n && hasTicker(n.children)) {
      const children = n.children.map(keep).filter((c): c is CardNode => !!c);
      return { ...n, children } as CardNode;
    }
    return withoutCharts(n);
  };
  return body.map(keep).filter((n): n is CardNode => !!n);
}
