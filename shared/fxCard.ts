import type { CardNode } from './card';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'INR', 'KRW', 'MXN', 'BRL', 'HKD', 'SGD', 'SEK', 'NOK', 'NZD', 'KWD', 'ZAR', 'TRY', 'RUB'];
/** Currency names that are never the dollar, yen, euro or pound of a pair asked about. */
const OTHER_MONEY = /\b(?:ringgit|dinars?|fils|pesos?|rupees?|yuan|renminbi|baht|rupiah|lira|rand|kron[ae]|kronor|dirhams?|riyals?|shekels?|zloty|forint|koruna|dong|hryvnia|naira|cedi|kwacha|taka|tenge|lari)\b/i;
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
  // "Ringgit cross 4.082 MYR per USD", "Kuwait cross 308 fils per USD": a cross rate or another currency, by name or
  // by any code priced per the pair's currency.
  if (/\bcross(?:\s+rates?)?\b/i.test(text) || OTHER_MONEY.test(text)) return true;
  const per = [...text.matchAll(/\b([A-Z]{3})\s+(?:per|\/)\s+([A-Z]{3})\b/g)];
  if (per.some((match) => ![fx.base, fx.quote].includes(match[1]!) || ![fx.base, fx.quote].includes(match[2]!))) return true;
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

export interface LiveQuoteFacts {
  price: number;
  /** Change over the widget's range, in percent. */
  pct: number;
  /** Changes the live quote feed itself states ("+0.69%" over 24 hours, beside the widget's change since midnight). */
  feedPcts?: number[];
  /** The close the widget's day change counts from. */
  previousClose?: number;
}

/** The percentage changes a live quote row states. */
export function feedPcts(text: string): number[] {
  return [...text.matchAll(/([+-−]?\d{1,2}(?:\.\d+)?)\s?%/g)].map((match) => Math.abs(Number(match[1]!.replace('−', '-'))));
}

/** A stock, crypto, index or commodity widget's price and day change. */
export function liveQuoteFacts(ticker: CardNode | undefined): LiveQuoteFacts | undefined {
  if (!ticker || ticker.type !== 'ticker' || ticker.kind === 'fx') return undefined;
  const { price, base, range } = ticker.series;
  if (!Number.isFinite(price) || price <= 0 || range !== '1D') return undefined;
  return { price, pct: base ? ((price - base) / base) * 100 : 0, previousClose: base || undefined };
}

/** Words that mark a figure as another time or another quantity, not the price right now. */
const HISTORY = /\b(?:low|high|range|close[ds]?|closing|open(?:ed)?|week|weeks|month|months|year|years|52|ago|since|target|forecast|record|all-time|ath|peak|earlier|previous|prior|ipo|q[1-4]|quarter|average|support|resistance|cap|volume|revenue|earnings|eps|guidance|dividend|yield|yesterday|last (?:week|month|year)|whether|pullback|breaks?|breakdown|breakout|levels?|retest|reclaim)\b/i;
const DAY_MOVE = /\b(?:today|24h|24-hour|24 hours|day|session|intraday|now|currently|this morning|this afternoon)\b/i;

const moneyFigures = (text: string) => [...text.replace(/\[\d+\]/g, ' ').matchAll(/[$€£¥]\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K|m|M|b|B)?\b/g)]
  .filter((match) => !match[2])
  .map((match) => Number(match[1]!.replace(/,/g, '')));

/**
 * A piece of a live-quote card that states a different price right now ("trading around $81,184" beside the widget's
 * $82,423, "Stock hit $14.19 … $13.58" beside $8.39) or a different change today ("+0.84%" beside +0.48%).
 */
function contradictsQuote(text: string, quote: LiveQuoteFacts): boolean {
  const bare = text.replace(/\[\d+\]/g, ' ');
  const figure = moneyFigures(bare)[0] ?? Number(bare.match(/\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/)?.[1]?.replace(/,/g, '') ?? NaN);
  if (Number.isFinite(figure) && figure > quote.price * 0.4 && figure < quote.price * 2.5) {
    // "Prev close $217.23" beside a widget that counts from 214.13 is an earlier session's close.
    if (quote.previousClose && /\b(?:prev(?:ious)?\.?|prior|last|yesterday['’]?s?)\s+close\b/i.test(bare) && Math.abs(figure - quote.previousClose) / quote.previousClose > 0.005) return true;
    // A day or 52-week high under the live price, or a low above it, is from before the price got here.
    const span = /\b(?:day|today['’]?s?|session|intraday|52[- ]?week)\b[^.]{0,12}\b(high|low)\b|^\s*(high|low)\b/i.exec(bare);
    const side = (span?.[1] ?? span?.[2])?.toLowerCase();
    if (side === 'high' && figure < quote.price * 0.997) return true;
    if (side === 'low' && figure > quote.price * 1.003) return true;
  }
  // "Below the 200-day average at 82,364" while the price is 82,581: a level the price is said to be under (or over)
  // that the live price is not. This holds even for history words, since it is a claim about the price now.
  const level = text.replace(/\[\d+\]/g, ' ').match(/\b(below|under|above|over)\b[^.]{0,60}?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)/i);
  if (level) {
    const value = Number(level[2]!.replace(/,/g, ''));
    if (value > quote.price * 0.5 && value < quote.price * 2) {
      const under = /^(?:below|under)$/i.test(level[1]!);
      if ((under && quote.price > value) || (!under && quote.price < value)) return true;
    }
  }
  // A history word marks only its own clause: in "BTC slipped to $81,017 as network difficulty rose 5.92% since
  // Oct 16" the "since" dates the difficulty, and the price is still stated as where BTC is now.
  return text.split(/\s*[,;:]\s+|\s+(?:as|while|after|but|and|amid|with)\s+/i).some((clause) => {
    if (HISTORY.test(clause)) return false;
    if (moneyFigures(clause).some((m) => m > quote.price * 0.4 && m < quote.price * 2.5 && Math.abs(m - quote.price) / quote.price > 0.01)) return true;
    if (!DAY_MOVE.test(clause)) return false;
    const pcts = [...clause.matchAll(/([+-−]?\d{1,2}(?:\.\d+)?)\s?%/g)].map((match) => Math.abs(Number(match[1]!.replace('−', '-'))));
    // The widget counts from midnight; the feed's own 24-hour change is another window of the same live price.
    return pcts.some((pct) => Math.abs(pct - Math.abs(quote.pct)) > 0.15 && !(quote.feedPcts ?? []).some((feed) => Math.abs(feed - pct) < 0.02));
  });
}

/** A live-quote card agrees with its own widget: no second, different "now". */
export function withinQuote(node: CardNode, quote: LiveQuoteFacts): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withinQuote(child, quote)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'tile':
      return contradictsQuote(`${node.label} ${node.value ?? ''} ${node.sub ?? ''}`, quote) ? undefined : node;
    case 'stat':
      // A stat keeps its percent sign in `unit` ("-1.43" + "%"): read together, it is the day change it claims.
      return contradictsQuote(`${node.label} ${node.value}${node.unit === '%' ? '%' : ''} ${node.delta ?? ''}`, quote) ? undefined : node;
    case 'hero': {
      // The widget above already shows the price large: a hero restating it is the same number twice.
      const amount = Number(node.value.replace(/[^\d.]/g, ''));
      if (/^\s*[$€£¥]?\s?\d[\d,]*(?:\.\d+)?\s*$/.test(node.value) && amount > 0 && Math.abs(amount - quote.price) / quote.price < 0.005) return undefined;
      return contradictsQuote(`${node.label ?? ''} ${node.value} ${node.caption ?? ''}`, quote) ? undefined : node;
    }
    case 'keyvalue': {
      const items = node.items.filter((item) => !contradictsQuote(`${item.label} ${item.value}`, quote));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'list': {
      const items = node.items.filter((item) => !contradictsQuote(`${item.text} ${item.meta ?? ''}`, quote));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'text':
    case 'callout': {
      const kept = node.text.split(/(?<=[.!?])\s+/).filter((sentence) => !contradictsQuote(sentence, quote)).join(' ').trim();
      if (kept === node.text) return node;
      return kept ? { ...node, text: kept } : undefined;
    }
    default:
      return node;
  }
}

/**
 * The day and 52-week ranges a live quote row states ("day range 81,942.16–82,682.14; 52-week range …"), as tiles
 * cited to that row. Undefined when the row states neither.
 */
export function quoteRanges(text: string, ref: number, currency?: string): CardNode | undefined {
  const range = (label: RegExp) => text.match(new RegExp(`${label.source}\\s+(\\d[\\d,]*(?:\\.\\d+)?\\s?[–-]\\s?\\d[\\d,]*(?:\\.\\d+)?)`, 'i'))?.[1];
  const day = range(/\bday(?:'s)? range/);
  const year = range(/\b52-week range/);
  const tiles: CardNode[] = [];
  if (day) tiles.push({ type: 'tile', label: 'Day range', value: day, sub: currency, icon: 'arrow-up-down', source: ref });
  if (year) tiles.push({ type: 'tile', label: '52-week range', value: year, sub: currency, icon: 'calendar-range', source: ref });
  return tiles.length ? { type: 'grid', cols: 2, children: tiles } : undefined;
}
