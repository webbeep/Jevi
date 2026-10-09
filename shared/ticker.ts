import type { QuoteKind } from './quoteAsk';

export const TICKER_RANGES = ['1D', '1W', '1M', '3M', '1Y', '5Y'] as const;
export type TickerRange = (typeof TICKER_RANGES)[number];

/** A price series: [unix seconds, price], oldest first. */
export type TickerPoint = [number, number];

export interface TickerSeries {
  range: TickerRange;
  points: TickerPoint[];
  /** The price the range's change is measured from: the previous close for 1D, else the first point. */
  base: number;
  price: number;
  at: string;
}

export interface TickerNodeData {
  symbol: string;
  name: string;
  kind: QuoteKind;
  currency: string;
  /** Where the numbers come from, for the footer. */
  feed: string;
  series: TickerSeries;
}

export const isTickerRange = (v: unknown): v is TickerRange => typeof v === 'string' && (TICKER_RANGES as readonly string[]).includes(v);

/** Symbols the quote endpoint accepts: AAPL, BTC-USD, EURUSD=X, GC=F, ^GSPC, BRK.B. */
export const TICKER_SYMBOL = /^[A-Z0-9^][A-Z0-9.=\-^]{0,14}$/i;

/** Change over the range, as an amount and a percentage of the base. */
export function rangeChange(price: number, base: number): { amount: number; pct: number } {
  const amount = price - base;
  return { amount, pct: base ? (amount / base) * 100 : 0 };
}

/** Price text with digits that fit the size of the number. */
export function priceText(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
