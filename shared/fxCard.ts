import type { CardNode } from './card';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'INR', 'KRW', 'MXN', 'BRL', 'HKD', 'SGD', 'SEK', 'NOK', 'NZD', 'KWD', 'ZAR', 'TRY', 'RUB'];
const SIGN: Record<string, string> = { '£': 'GBP', '€': 'EUR', '₹': 'INR', '₩': 'KRW' };

export interface FxQuote {
  /** The currency one unit of is priced ("USD" in USD/JPY). */
  base: string;
  /** The currency the price is in ("JPY"). */
  quote: string;
  price: number;
}

/** "USDJPY=X" or "JPY=X" with currency JPY → USD/JPY at that price. */
export function fxQuote(ticker: CardNode | undefined): FxQuote | undefined {
  if (!ticker || ticker.type !== 'ticker' || ticker.kind !== 'fx') return undefined;
  const symbol = ticker.symbol.toUpperCase().replace(/=X$/, '');
  const quote = ticker.currency.toUpperCase();
  const base = symbol.length === 6 ? symbol.slice(0, 3) : 'USD';
  return base && quote && base !== quote ? { base, quote, price: ticker.series.price } : undefined;
}

const numbers = (text: string) => [...text.replace(/\[\d+\]/g, ' ').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => Number(match[0].replace(/,/g, '')));

/**
 * A piece of an exchange-rate card that tells the other story: the inverse rate ("1 JPY in USD 0.0063"), another
 * currency ("1 GBP 210.10 JPY"), or a second rate for the same pair that the live quote does not show ("Spot fix
 * 158.34" beside 158.02). A low, high, close or range figure is a different quantity and stays.
 */
function offStory(text: string, fx: FxQuote): boolean {
  const codes = new Set([...text.toUpperCase().matchAll(/\b([A-Z]{3})\b/g)].map((match) => match[1]!).filter((code) => CURRENCIES.includes(code)));
  for (const [sign, code] of Object.entries(SIGN)) if (text.includes(sign)) codes.add(code);
  if ([...codes].some((code) => code !== fx.base && code !== fx.quote)) return true;
  const inverse = 1 / fx.price;
  const nums = numbers(text);
  if (nums.some((n) => n > 0 && n < 1 && Math.abs(n - inverse) / inverse < 0.05)) return true;
  if (/\b(?:low|high|range|close[ds]?|open|week|month|year|52|forecast|ago|from|since)\b/i.test(text)) return false;
  return nums.some((n) => Math.abs(n - fx.price) / fx.price < 0.03 && Math.abs(n - fx.price) / fx.price > 0.001);
}

/** An exchange-rate card keeps to the pair and direction asked, at the live quote's rate. */
export function withinFx(node: CardNode, fx: FxQuote): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withinFx(child, fx)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'tile':
      return offStory(`${node.label} ${node.value ?? ''} ${node.sub ?? ''}`, fx) ? undefined : node;
    case 'stat':
      return offStory(`${node.label} ${node.value}`, fx) ? undefined : node;
    case 'hero':
      return offStory(`${node.label ?? ''} ${node.value} ${node.unit ?? ''}`, fx) ? undefined : node;
    case 'keyvalue': {
      const items = node.items.filter((item) => !offStory(`${item.label} ${item.value}`, fx));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'list': {
      const items = node.items.filter((item) => !offStory(`${item.text} ${item.meta ?? ''}`, fx));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'text':
    case 'callout': {
      const kept = node.text.split(/(?<=[.!?])\s+/).filter((sentence) => !offStory(sentence, fx)).join(' ').trim();
      if (kept === node.text) return node;
      return kept ? { ...node, text: kept } : undefined;
    }
    default:
      return node;
  }
}
