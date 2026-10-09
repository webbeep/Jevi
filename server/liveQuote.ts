import { type QuoteAsk, type QuoteKind, quoteAsk } from '../shared/quoteAsk';
import type { SearchResult } from '../shared/types';
import { fetchJson } from './util';

/** Keyless market data; the whole lookup must stay inside the time the web search takes anyway. */
const QUOTE_MS = 1800;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; zo2/1.0)' };
export const QUOTE_ENGINE = 'quote';

export interface LiveQuote {
  symbol: string;
  name: string;
  kind: QuoteKind;
  currency: string;
  price: number;
  changePct?: number;
  dayHigh?: number;
  dayLow?: number;
  yearHigh?: number;
  yearLow?: number;
  /** Daily closes, oldest first. */
  closes: { day: string; close: number }[];
  at: Date;
  source: 'yahoo' | 'coinbase';
}

interface YahooChart {
  chart?: {
    result?: {
      meta: {
        currency?: string;
        symbol: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice?: number;
        regularMarketChangePercent?: number;
        regularMarketTime?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

interface YahooSearch {
  quotes?: { symbol: string; quoteType?: string; shortname?: string; longname?: string }[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

async function yahoo(symbol: string, kind: QuoteKind, fallbackName: string): Promise<LiveQuote | undefined> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  const res = (await fetchJson<YahooChart>(url, { headers: UA }, QUOTE_MS)).chart?.result?.[0];
  const meta = res?.meta;
  if (!meta || !finite(meta.regularMarketPrice) || meta.regularMarketPrice <= 0) return undefined;
  const raw = res.indicators?.quote?.[0]?.close ?? [];
  const closes = (res.timestamp ?? [])
    .map((t, i) => ({ day: new Date(t * 1000).toISOString().slice(0, 10), close: raw[i] }))
    .filter((c): c is { day: string; close: number } => finite(c.close));
  const prev = closes.length >= 2 ? closes[closes.length - 2]!.close : undefined;
  const changePct = finite(meta.regularMarketChangePercent)
    ? meta.regularMarketChangePercent
    : prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : undefined;
  return {
    symbol: meta.symbol || symbol,
    name: kind === 'stock' ? meta.longName || meta.shortName || fallbackName : fallbackName,
    kind,
    currency: meta.currency || 'USD',
    price: meta.regularMarketPrice,
    changePct,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    yearHigh: meta.fiftyTwoWeekHigh,
    yearLow: meta.fiftyTwoWeekLow,
    closes,
    at: finite(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000) : new Date(),
    source: 'yahoo',
  };
}

async function coinbase(symbol: string, name: string): Promise<LiveQuote | undefined> {
  const base = `https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}`;
  const [tick, stats] = await Promise.all([
    fetchJson<{ price?: string; time?: string }>(`${base}/ticker`, { headers: UA }, QUOTE_MS),
    fetchJson<{ open?: string; high?: string; low?: string }>(`${base}/stats`, { headers: UA }, QUOTE_MS).catch(() => ({} as { open?: string; high?: string; low?: string })),
  ]);
  const price = Number(tick.price);
  if (!finite(price) || price <= 0) return undefined;
  const open = Number(stats.open);
  return {
    symbol,
    name,
    kind: 'crypto',
    currency: symbol.split('-')[1] ?? 'USD',
    price,
    changePct: finite(open) && open > 0 ? ((price - open) / open) * 100 : undefined,
    dayHigh: Number(stats.high) || undefined,
    dayLow: Number(stats.low) || undefined,
    closes: [],
    at: tick.time ? new Date(tick.time) : new Date(),
    source: 'coinbase',
  };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** "tesla stock" → TSLA, only when the listing's name carries the asker's words. */
async function lookupSymbol(name: string): Promise<{ symbol: string; name: string } | undefined> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=5&newsCount=0`;
  const found = await fetchJson<YahooSearch>(url, { headers: UA }, QUOTE_MS);
  const asked = words(name);
  const hit = (found.quotes ?? []).find((q) => {
    if (q.quoteType !== 'EQUITY' && q.quoteType !== 'ETF') return false;
    const listed = new Set(words(`${q.longname ?? ''} ${q.shortname ?? ''}`));
    return q.symbol.toLowerCase() === name.toLowerCase() || asked.every((w) => listed.has(w));
  });
  return hit ? { symbol: hit.symbol, name: hit.longname || hit.shortname || hit.symbol } : undefined;
}

async function resolve(ask: QuoteAsk): Promise<{ symbol: string; name: string; kind: QuoteKind } | undefined> {
  if ('symbol' in ask) return ask;
  const hit = await lookupSymbol(ask.lookup);
  return hit && { ...hit, kind: 'stock' };
}

export async function liveQuote(query: string): Promise<LiveQuote | undefined> {
  const ask = quoteAsk(query);
  if (!ask) return undefined;
  try {
    const target = await resolve(ask);
    if (!target) return undefined;
    const fromYahoo = await yahoo(target.symbol, target.kind, target.name).catch(() => undefined);
    if (fromYahoo) return fromYahoo;
    return target.kind === 'crypto' ? await coinbase(target.symbol, target.name) : undefined;
  } catch (err) {
    console.log(JSON.stringify({ zo: 'quote', failed: 'symbol' in ask ? ask.symbol : ask.lookup, error: String(err).slice(0, 120) }));
    return undefined;
  }
}

export function formatPrice(n: number): string {
  const digits = Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const range = (lo?: number, hi?: number) => (finite(lo) && finite(hi) ? `${formatPrice(lo)}–${formatPrice(hi)}` : '');

/** The quote as source [1]: every number the card may show is written out in the snippet or page text. */
export function quoteRow(q: LiveQuote): SearchResult {
  const unit = q.kind === 'fx' ? '' : q.kind === 'index' ? ' points' : ` ${q.currency}`;
  const label = q.kind === 'stock' ? `${q.name} (${q.symbol})` : q.kind === 'crypto' ? `${q.name} (${q.symbol.split('-')[0]})` : q.name;
  const day = range(q.dayLow, q.dayHigh);
  const year = range(q.yearLow, q.yearHigh);
  const snippet = [
    `Live price at ${utc(q.at)}: ${formatPrice(q.price)}${unit}`,
    finite(q.changePct) ? `${pct(q.changePct)} over the last day` : '',
    day ? `day range ${day}` : '',
    year ? `52-week range ${year}` : '',
  ].filter(Boolean).join('; ');
  const closes = q.closes.length >= 3
    ? `\nDaily closes, last ${q.closes.length} trading days (${q.currency}): ${q.closes.map((c) => `${c.day} ${formatPrice(c.close)}`).join('; ')}.`
    : '';
  const url = q.source === 'coinbase'
    ? `https://www.coinbase.com/price/${q.name.toLowerCase().replace(/\s+/g, '-')}`
    : `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}`;
  return {
    title: `${label} live price`,
    url,
    snippet: `${snippet}.`,
    domain: q.source === 'coinbase' ? 'coinbase.com' : 'finance.yahoo.com',
    engines: [QUOTE_ENGINE],
    date: q.at.toISOString(),
    content: `${label} — live market quote (not a news article).\n${snippet}.${closes}`,
  };
}

export const isQuoteRow = (row: SearchResult | undefined) => !!row?.engines.includes(QUOTE_ENGINE);
