import type { CardNode } from '../shared/card';
import type { ClaimSource } from './claims';

/** Hosts whose "$" is another country's dollar (amazon.ca, jbhifi.com.au). */
const FOREIGN_DOLLAR_HOST = /\.(?:ca|au|nz|sg|hk|tw|mx|ar|cl|co|com\.au|com\.sg|com\.hk|com\.tw|com\.mx|com\.ar|com\.co|co\.nz)$/i;
/** A question about another market: its prices are the ones asked for. */
const FOREIGN_ASK = /\b(?:uk|u\.k\.|britain|british|england|canada|canadian|australia|australian|new zealand|india|indian|europe|european|eu|germany|france|japan|singapore|hong kong|mexico|cad|aud|gbp|eur|inr|nzd|sgd|pounds?|euros?|rupees?|yen)\b|[£€₹¥]/i;
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)(?!\d)/g;

const digits = (raw: string) => raw.replace(/,/g, '');

/**
 * Where the pages state this amount: as US dollars ("$249" on a US page), only as another currency ("£249", "CA$249",
 * "$249" on amazon.ca), or nowhere.
 */
function statedAs(amount: string, sources: readonly ClaimSource[]): 'us' | 'foreign' | 'none' {
  const bare = digits(amount);
  let foreign = false;
  for (const source of sources) {
    const text = `${source.stated ?? ''} ${source.text}`;
    const host = (source.domain ?? '').toLowerCase();
    const re = /((?:[A-Z]{1,3})?\$|[£€₹¥]|USD\s?|US\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)(?!\d)/g;
    for (const match of text.matchAll(re)) {
      if (digits(match[2]!) !== bare) continue;
      const mark = match[1]!.trim();
      if ((mark === '$' && !FOREIGN_DOLLAR_HOST.test(host)) || mark === 'US$' || mark === 'USD') return 'us';
      foreign = true;
    }
  }
  return foreign ? 'foreign' : 'none';
}

/** The text without the US-dollar amounts the pages give only in another currency. */
function withoutForeign(text: string | undefined, sources: readonly ClaimSource[]): string | undefined {
  if (!text || !text.includes('$')) return text;
  let out = text;
  for (const match of text.matchAll(AMOUNT)) {
    if (statedAs(match[1]!, sources) !== 'foreign') continue;
    out = out.replace(match[0], ' ');
  }
  if (out === text) return text;
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/^[\s·,;:–—-]+|[\s·,;:–—-]+$/g, '').trim();
  return out;
}

/**
 * A price shown in dollars to a US reader is one a page states in US dollars. "£249" on a UK review or "$329" on
 * amazon.ca is not the US price, so that amount leaves the card. A question about another market keeps its prices.
 */
export function keepUsPrices(node: CardNode, sources: readonly ClaimSource[], query: string): CardNode {
  if (FOREIGN_ASK.test(query)) return node;
  const fix = (text: string | undefined) => withoutForeign(text, sources);
  switch (node.type) {
    case 'tile': {
      const value = fix(node.value);
      const sub = fix(node.sub);
      return value === node.value && sub === node.sub ? node : { ...node, value: value || undefined, sub: sub || undefined };
    }
    case 'hero': {
      const value = fix(node.value) ?? '';
      return value === node.value ? node : { ...node, value };
    }
    case 'stat': {
      const value = fix(node.value) ?? '';
      return value === node.value ? node : { ...node, value };
    }
    case 'table': {
      const rows = node.rows.map((row) => row.map((cell, i) => (i === 0 ? cell : fix(cell) ?? '')));
      return rows.every((row, i) => row.every((cell, j) => cell === node.rows[i]![j])) ? node : { ...node, rows };
    }
    case 'list': {
      const items = node.items.map((item) => {
        const meta = fix(item.meta);
        const text = fix(item.text) ?? item.text;
        return meta === item.meta && text === item.text ? item : { ...item, meta: meta || undefined, text };
      });
      return items.every((item, i) => item === node.items[i]) ? node : { ...node, items };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = fix(item.value) ?? '';
        return value === item.value ? item : { ...item, value };
      });
      return items.every((item, i) => item === node.items[i]) ? node : { ...node, items };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => keepUsPrices(child, sources, query));
      return children.every((child, i) => child === node.children[i]) ? node : ({ ...node, children } as CardNode);
    }
    case 'tabs': {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => keepUsPrices(child, sources, query)) }));
      return tabs.every((tab, i) => tab.children.every((child, j) => child === node.tabs[i]!.children[j])) ? node : { ...node, tabs };
    }
    default:
      return node;
  }
}
