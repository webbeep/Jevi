import type { CardNode } from '../shared/card';
import type { ClaimSource } from './claims';

/** Stores a card names beside a price, and the sites that are theirs. */
const RETAILERS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\bamazon\b/i, ['amazon.com']],
  [/\bbest ?buy\b/i, ['bestbuy.com']],
  [/\bwalmart\b/i, ['walmart.com']],
  [/\bTarget\b/, ['target.com']],
  [/\bcostco\b/i, ['costco.com']],
  [/\bebay\b/i, ['ebay.com']],
  [/\bnewegg\b/i, ['newegg.com']],
  [/\bb ?& ?h\b|\bb&h photo\b/i, ['bhphotovideo.com']],
  [/\bgamestop\b/i, ['gamestop.com']],
  [/\bmacy'?s\b/i, ['macys.com']],
];

const AMOUNT = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
const value = (raw: string) => Number(raw.replace(/[^0-9.]/g, ''));
const cites = (text: string) => [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

function retailerOf(label: string): (typeof RETAILERS)[number] | undefined {
  return RETAILERS.find(([name]) => name.test(label));
}

/**
 * The page states this store's price: it is the store's own page and shows the amount, or its text names the store
 * within a short span of the amount ("Apple AirPods Pro 3 at Amazon — $199"). A spec page cited for "Amazon $199"
 * does not state it.
 */
function statesStorePrice(store: (typeof RETAILERS)[number], amount: number, source: ClaimSource | undefined): boolean {
  if (!source) return false;
  const text = `${source.stated ?? ''} ${source.text}`;
  const host = (source.domain ?? '').toLowerCase().replace(/^www\./, '');
  const amounts = [...text.matchAll(AMOUNT)];
  const hit = amounts.filter((m) => Math.abs(value(m[0]) - amount) < 0.005);
  if (!hit.length) return false;
  if (store[1].some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
  return hit.some((m) => store[0].test(text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120)));
}

/** Any page that states this store's price; the first one, as the citation the price moves to. */
function storeSource(store: (typeof RETAILERS)[number], amount: number, sources: readonly ClaimSource[]): ClaimSource | undefined {
  return sources.find((source) => statesStorePrice(store, amount, source));
}

/** A store's price on the card stays only when a page states it for that store. Otherwise the price goes, and an
 * entry left with nothing but the store's name goes with it. */
export function keepStorePrices(node: CardNode, sources: readonly ClaimSource[]): CardNode | undefined {
  const supported = (label: string, text: string, cited: number | undefined): { ok: boolean; n?: number } => {
    const store = retailerOf(label);
    const amounts = text.match(AMOUNT);
    if (!store || !amounts) return { ok: true };
    const amount = value(amounts[0]!);
    const named = [cited, ...cites(text)].filter((n): n is number => typeof n === 'number');
    if (named.some((n) => statesStorePrice(store, amount, sources.find((source) => source.n === n)))) return { ok: true };
    const elsewhere = storeSource(store, amount, sources);
    return elsewhere ? { ok: true, n: elsewhere.n } : { ok: false };
  };
  switch (node.type) {
    case 'tile': {
      // "Resale $94.76 · Used, eBay listing": the store can be named under the label too.
      const check = supported(`${node.label} ${node.sub ?? ''}`, `${node.value ?? ''} ${node.sub ?? ''}`, node.source);
      if (check.ok) return check.n && check.n !== node.source ? { ...node, source: check.n } : node;
      return undefined;
    }
    case 'list': {
      const items = node.items.filter((item) => supported(item.text, `${item.meta ?? ''} ${item.text}`, item.source).ok);
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'keyvalue': {
      const items = node.items.filter((item) => supported(item.label, item.value, undefined).ok);
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'table': {
      const rows = node.rows.filter((row) => supported(row[0] ?? '', row.slice(1).join(' '), undefined).ok);
      if (rows.length === node.rows.length) return node;
      return rows.length ? { ...node, rows } : undefined;
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => keepStorePrices(child, sources)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? ({ ...node, children } as CardNode) : undefined;
    }
    case 'tabs': {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => keepStorePrices(child, sources)).filter((child): child is CardNode => !!child) }));
      return tabs.every((tab, i) => tab.children.length === node.tabs[i]!.children.length && tab.children.every((child, j) => child === node.tabs[i]!.children[j])) ? node : { ...node, tabs };
    }
    default:
      return node;
  }
}
