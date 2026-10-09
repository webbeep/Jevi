/**
 * Asks whose answer is a market price that moves by the second ("Btc Usd", "bitcoin price",
 * "$NVDA", "tesla stock", "usd to jpy", "gold price"). Pure, so the answer cache and the server agree.
 */
export type QuoteKind = 'crypto' | 'stock' | 'fx' | 'commodity' | 'index';

export type QuoteAsk =
  | { kind: QuoteKind; symbol: string; name: string }
  /** A company named in words ("tesla stock"): the symbol comes from a lookup. */
  | { kind: 'stock'; lookup: string };

const CRYPTO: Record<string, [string, string]> = {
  btc: ['BTC', 'Bitcoin'], bitcoin: ['BTC', 'Bitcoin'], xbt: ['BTC', 'Bitcoin'],
  eth: ['ETH', 'Ethereum'], ethereum: ['ETH', 'Ethereum'], ether: ['ETH', 'Ethereum'],
  sol: ['SOL', 'Solana'], solana: ['SOL', 'Solana'],
  xrp: ['XRP', 'XRP'], ripple: ['XRP', 'XRP'],
  doge: ['DOGE', 'Dogecoin'], dogecoin: ['DOGE', 'Dogecoin'],
  ada: ['ADA', 'Cardano'], cardano: ['ADA', 'Cardano'],
  bnb: ['BNB', 'BNB'],
  ltc: ['LTC', 'Litecoin'], litecoin: ['LTC', 'Litecoin'],
  dot: ['DOT', 'Polkadot'], polkadot: ['DOT', 'Polkadot'],
  avax: ['AVAX', 'Avalanche'], avalanche: ['AVAX', 'Avalanche'],
  link: ['LINK', 'Chainlink'], chainlink: ['LINK', 'Chainlink'],
  trx: ['TRX', 'TRON'], tron: ['TRX', 'TRON'],
  shib: ['SHIB', 'Shiba Inu'],
  sui: ['SUI', 'Sui'],
  ton: ['TON', 'Toncoin'], toncoin: ['TON', 'Toncoin'],
};

/** Words that never stand alone for a coin: "link", "dot", "sol", "ton" and "ether" are ordinary words too. */
const AMBIGUOUS_COIN = new Set(['link', 'dot', 'sol', 'ton', 'ether', 'avalanche', 'tron', 'ada', 'sui']);

const FIAT = ['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'cny', 'inr', 'krw', 'sgd', 'hkd', 'mxn', 'brl', 'nzd', 'sek', 'nok', 'zar'];
const STABLE: Record<string, string> = { usdt: 'usd', usdc: 'usd' };
const FIAT_RE = FIAT.join('|');
const QUOTE_CCY = `${FIAT_RE}|usdt|usdc`;

const COMMODITY: [RegExp, string, string][] = [
  [/\bgold\b/, 'GC=F', 'Gold futures'],
  [/\bsilver\b/, 'SI=F', 'Silver futures'],
  [/\bbrent\b/, 'BZ=F', 'Brent crude futures'],
  [/\b(?:crude|wti)\b|(?<!\b(?:olive|coconut|essential|motor|cooking|engine|fish|cbd|hair|palm|vegetable|castor|baby|avocado|sesame|canola|heating) )\boil\b/, 'CL=F', 'WTI crude futures'],
  [/\bnatural gas\b/, 'NG=F', 'Natural gas futures'],
  [/\bcopper\b/, 'HG=F', 'Copper futures'],
];

const INDEX: [RegExp, string, string][] = [
  [/\b(?:s&p(?: ?500)?|sp ?500|spx)\b/, '^GSPC', 'S&P 500'],
  [/\b(?:dow jones|djia)\b|\bdow\b(?! chemical| inc)/, '^DJI', 'Dow Jones Industrial Average'],
  [/\b(?:nasdaq(?: composite)?)\b/, '^IXIC', 'Nasdaq Composite'],
  [/\brussell ?2000\b/, '^RUT', 'Russell 2000'],
  [/\bvix\b/, '^VIX', 'CBOE Volatility Index'],
];

/** Said about a price: what it is now, or how it is moving. */
const PRICE_WORDS = /\b(?:price[sd]?|quotes?|trading|trades|worth|how much|charts?|rate|today|right now|live|current(?:ly)?|drop(?:s|ped|ping)?|pump(?:ing)?|dump(?:ing)?|rall(?:y|ied|ying)|crash(?:ed|ing)?|surg(?:e|ed|ing)|falling|fell|rising|tank(?:ed|ing)?|spik(?:e|ed|ing)|moon(?:ing)?|ath|all[- ]time high|market cap)\b/;
/** "is bitcoin up", "btc down today" — but not "set up a bitcoin wallet". */
const MOVE_AT_END = /\b(?:up|down|now)(?: today| now| this week)?\s*$/;
const PRICEY = { test: (q: string) => PRICE_WORDS.test(q) || MOVE_AT_END.test(q) };

/** Stock asks name one company: these words make it a list or a topic instead. */
const NOT_A_COMPANY = new Set([
  'best', 'top', 'penny', 'cheap', 'growth', 'dividend', 'value', 'tech', 'ai', 'meme', 'blue', 'chip', 'buy', 'sell',
  'which', 'what', 'why', 'how', 'is', 'are', 'was', 'the', 'a', 'an', 'my', 'did', 'does', 'do', 'should', 'i', 'to', 'of',
  'for', 'in', 'on', 'today', 'now', 'price', 'prices', 'current', 'latest', 'stock', 'stocks', 'share', 'shares', 'market',
  'us', 'news', 'up', 'down', 'falling', 'rising', 'dropping', 'going', 'so', 'much', 'many', 'buying', 'selling', 'trading',
]);

const CASHTAG = /(?:^|[^A-Za-z0-9])\$([A-Za-z]{1,5})(?![A-Za-z0-9])/;

function norm(query: string): string {
  return ` ${query.toLowerCase().replace(/[“”"'’?!,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function cryptoPair(q: string): QuoteAsk | undefined {
  const coins = Object.keys(CRYPTO).join('|');
  const pair = q.match(new RegExp(`\\s(${coins})\\s*(?:[/\\-]|\\s|\\bto\\b|\\bin\\b)?\\s*(${QUOTE_CCY})\\s`));
  if (!pair) return undefined;
  const [sym, name] = CRYPTO[pair[1]!]!;
  const ccy = (STABLE[pair[2]!] ?? pair[2]!).toUpperCase();
  return { kind: 'crypto', symbol: `${sym}-${ccy}`, name };
}

function fxPair(q: string): QuoteAsk | undefined {
  const m = q.match(new RegExp(`\\s(${FIAT_RE})\\s*(?:[/\\-]|\\s|\\bto\\b|\\bin\\b|\\bvs\\.?\\b)?\\s*(${FIAT_RE})\\s`));
  if (!m || m[1] === m[2]) return undefined;
  const bare = q.trim().split(' ').length <= 3;
  if (!bare && !/\b(?:rate|exchange|convert|price|today|now|forex|fx)\b/.test(q)) return undefined;
  const [a, b] = [m[1]!.toUpperCase(), m[2]!.toUpperCase()];
  return { kind: 'fx', symbol: `${a}${b}=X`, name: `${a} to ${b}` };
}

function coinAlone(q: string): QuoteAsk | undefined {
  const words = q.trim().split(' ');
  const hit = words.find((w) => CRYPTO[w]);
  if (!hit) return undefined;
  const onlyCoin = words.length === 1 && !AMBIGUOUS_COIN.has(hit);
  if (!onlyCoin && !PRICEY.test(q)) return undefined;
  if (AMBIGUOUS_COIN.has(hit) && !/\b(?:price|crypto|coin|token|usd)\b/.test(q)) return undefined;
  const [sym, name] = CRYPTO[hit]!;
  return { kind: 'crypto', symbol: `${sym}-USD`, name };
}

function fromTable(q: string, table: [RegExp, string, string][], kind: QuoteKind, needs: RegExp): QuoteAsk | undefined {
  if (!needs.test(q)) return undefined;
  for (const [re, symbol, name] of table) if (re.test(q)) return { kind, symbol, name };
  return undefined;
}

function stockAsk(raw: string, q: string): QuoteAsk | undefined {
  const tag = raw.match(CASHTAG)?.[1];
  if (tag) return { kind: 'stock', symbol: tag.toUpperCase(), name: tag.toUpperCase() };
  const m = raw.match(/^(.*?)\b(?:stock|shares?)\b(.*)$/i);
  if (!m || /\bstocks\b/i.test(raw)) return undefined;
  const words = m[1]!.replace(/['’]s\b/g, '').split(/[^A-Za-z0-9&.-]+/).filter(Boolean);
  const upper = words.find((w) => /^[A-Z]{1,5}$/.test(w) && !NOT_A_COMPANY.has(w.toLowerCase()));
  if (upper) return { kind: 'stock', symbol: upper, name: upper };
  const name = words.filter((w) => !NOT_A_COMPANY.has(w.toLowerCase())).slice(-3).join(' ');
  if (!name || !(PRICEY.test(q) || /\bstock\s*$/i.test(raw.trim()) || /\bshares?\s*$/i.test(raw.trim()))) return undefined;
  return { kind: 'stock', lookup: name };
}

export function quoteAsk(query: string): QuoteAsk | undefined {
  if (!query.trim() || query.length > 120) return undefined;
  const q = norm(query);
  const short = q.trim().split(' ').length <= 6;
  return cryptoPair(q)
    ?? fxPair(q)
    ?? coinAlone(q)
    ?? (short ? fromTable(q, COMMODITY, 'commodity', /\b(?:price[sd]?|prices|per ounce|barrel|futures|today|now|rate|trading|spot)\b/) : undefined)
    ?? (short && !/\b(?:stock|shares?)\b/.test(q) ? fromTable(q, INDEX, 'index', /\b(?:index|today|now|price|level|points|futures|up|down|drop(?:ped|ping)?|rall(?:y|ied)|close[sd]?|open(?:ed)?)\b/) : undefined)
    ?? stockAsk(query, q);
}
