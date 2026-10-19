import type { CardNode } from './card';

/** Talk about a chart, image or price series being unavailable — false on a card that opens with the live chart. */
export const CHART_TALK = /\b(chart|graph|image|picture|photo|price (?:data|history|series)|historical (?:data|prices))\b/i;
const UNAVAILABLE = /\b(no|not|unavailable|missing|isn'?t|aren'?t|couldn'?t|can'?t|cannot|without|lack)\b/i;

export const saysChartMissing = (text: string) => CHART_TALK.test(text) && UNAVAILABLE.test(text);

/** "No current Nvidia price came back", "Live quote unavailable": false beside the chart that shows the price. */
const PRICE_DENIAL = /\b(?:no|not|unavailable|couldn'?t|can'?t|cannot|wasn'?t|isn'?t)\b[^.!?]{0,60}\b(?:price|quote|market data)\b|\b(?:price|quote|market data)\b[^.!?]{0,40}\b(?:unavailable|not available|be confirmed|came back|found)\b/i;

export function deniesPrice(text: string | undefined): boolean {
  return !!text && PRICE_DENIAL.test(text) && /\b(?:no|not|unavailable|couldn'?t|can'?t|cannot|wasn'?t|isn'?t)\b/i.test(text);
}

/** A sentence that says the price is missing is dropped; the rest of the paragraph stays. */
function withoutPriceDenial(text: string): string {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => !deniesPrice(sentence)).join(' ').trim();
}

/**
 * Next to a ticker: a model-drawn chart only repeats the price, worse, and a note that a chart is missing is wrong.
 * Used on the server before a node is sent, and in the client for cards saved before that check existed.
 */
export function withoutCharts(node: CardNode | undefined): CardNode | undefined {
  if (!node || node.type === 'chart') return undefined;
  if ((node.type === 'callout' || node.type === 'text') && saysChartMissing(`${node.type === 'callout' ? node.title ?? '' : ''} ${node.text}`)) return undefined;
  if (node.type === 'hero' && deniesPrice(`${node.label ?? ''} ${node.value} ${node.caption ?? ''}`)) return undefined;
  // "No live price available" as a callout's title: the whole note is that denial.
  if (node.type === 'callout' && deniesPrice(node.title)) return undefined;
  if ((node.type === 'callout' || node.type === 'text') && deniesPrice(node.text)) {
    const text = withoutPriceDenial(node.text);
    return text ? { ...node, text } : undefined;
  }
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

/** The live price chart already on a card, including one nested in a layout. */
export function findTicker(nodes: readonly CardNode[]): Extract<CardNode, { type: 'ticker' }> | undefined {
  for (const node of nodes) {
    if (node.type === 'ticker') return node;
    if (node.type === 'tabs') {
      for (const tab of node.tabs) {
        const found = findTicker(tab.children);
        if (found) return found;
      }
    } else if ('children' in node && Array.isArray(node.children)) {
      const found = findTicker(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

const hasTicker = (nodes: readonly CardNode[]): boolean => findTicker(nodes) !== undefined;

function keepBesideTicker(n: CardNode): CardNode | undefined {
  if (n.type === 'ticker') return n;
  if ('children' in n && hasTicker(n.children)) {
    const children = n.children.map(keepBesideTicker).filter((c): c is CardNode => !!c);
    return { ...n, children } as CardNode;
  }
  return withoutCharts(n);
}

/** A card body with the ticker kept and everything that contradicts it removed. */
export function tickerBody(body: CardNode[]): CardNode[] {
  if (!hasTicker(body)) return body;
  return tickerRows(body.map((node) => ({ node }))).map((row) => row.node);
}

/** `tickerBody` over rows that carry something beside each node (its key on screen). */
export function tickerRows<R extends { node: CardNode }>(rows: R[]): R[] {
  if (!hasTicker(rows.map((row) => row.node))) return rows;
  return rows.flatMap((row) => {
    const node = keepBesideTicker(row.node);
    return node ? [{ ...row, node }] : [];
  });
}
