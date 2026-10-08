/**
 * Published plan prices and the team total computed from them.
 * Totals are a pure function of the price and a seat count — never a model estimate.
 */

export type PriceUnit = 'seat' | 'flat';
export type PricePeriod = 'month' | 'year';
export type BillingBasis = 'monthly' | 'annual';

/** A price as published. `amount` is omitted when it has no source URL from the search results. */
export interface Price {
  amount?: number;
  currency: string;
  unit: PriceUnit;
  /** What `amount` covers: a month or a year. */
  period: PricePeriod;
  /** How the customer is billed. Annual prices are often still quoted per month. */
  billing: BillingBasis;
  /** Smallest number of seats the plan can be bought for. Per-seat totals use this as a floor. */
  minSeats?: number;
  /** Seats included before per-seat charges start. */
  includedSeats?: number;
  sourceUrl?: string;
  /** Source fetch date, when the search result had one. */
  asOf?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cents, so 4 × $8.40 is 33.6 and not a binary float. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Monthly team total for `seats` people.
 * Per-seat prices multiply by seats, floored at `minSeats`.
 * Flat tiers stay the published price.
 * A year price is divided by 12 so the figure is always $/mo.
 * Returns null when the amount has no grounded source.
 */
export function monthlyTotal(price: Price, seats: number): number | null {
  if (price.amount == null || !Number.isFinite(price.amount) || price.amount < 0) return null;
  if (!price.sourceUrl?.trim()) return null;
  if (!Number.isFinite(seats) || seats < 0) return null;
  const perMonth = price.period === 'year' ? price.amount / 12 : price.amount;
  if (price.unit === 'flat') return roundMoney(perMonth);
  const floor = price.minSeats != null && price.minSeats > 0 ? price.minSeats : 0;
  let billed = Math.max(seats, floor);
  if (price.includedSeats != null && price.includedSeats > 0) billed = Math.max(0, billed - price.includedSeats);
  return roundMoney(perMonth * billed);
}

/** Seat count named in a question, e.g. "4 people", "10 engineers", "a 3-person agency". */
export function inferSeats(query: string): number | undefined {
  const q = query.toLowerCase();
  const patterns = [
    /\b(\d{1,4})\s*-\s*person\b/,
    /\b(\d{1,4})\s+(?:people|persons|users|seats|engineers|agents|employees|members|staff|developers|designers)\b/,
    /\b(?:team|group|office|company)\s+of\s+(\d{1,4})\b/,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 1 && n <= 10000) return n;
  }
  return undefined;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  const n = roundMoney(amount);
  if (currency === 'USD') {
    const digits = Number.isInteger(n) ? 0 : 2;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: 2 });
  }
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
}

/** "$7 per seat / month" or "$49 flat / month". A missing amount stays an em dash, with the unit still labelled. */
export function publishedLabel(price: Price): string {
  const each = price.unit === 'seat' ? 'per seat' : 'flat';
  const per = price.period === 'year' ? 'year' : 'month';
  const amount = price.amount == null ? '—' : formatMoney(price.amount, price.currency);
  return `${amount} ${each} / ${per}`;
}

export function billingLabel(billing: BillingBasis): string {
  return billing === 'annual' ? 'billed annually' : 'billed monthly';
}

/** The price for the selected basis. A grounded amount wins over an unsourced duplicate. */
export function priceForBasis(prices: Price[], billing: BillingBasis): Price | undefined {
  const matches = prices.filter((p) => p.billing === billing);
  return matches.find((p) => p.amount != null && p.sourceUrl) ?? matches[0];
}

/**
 * As-of label for a grounded price. A date on the result wins.
 * Otherwise the day we fetched it, so a sourced price is never undated.
 */
export function priceAsOf(sourceDate: string | undefined, retrieved: Date = new Date()): string | undefined {
  return formatAsOf(sourceDate) ?? formatAsOf(retrieved.toISOString().slice(0, 10));
}

const RE_BILLED_ANNUAL = /\b(billed annually|billed yearly|annual billing|yearly billing|per year|a year|\/\s?yr|\/\s?year)\b/i;
const RE_BILLED_MONTHLY = /\b(billed monthly|month-to-month|month to month|pay monthly|no commitment)\b/i;

/**
 * Billing basis stated next to this amount in the source.
 * "per month, billed annually" is annual. Undefined when the page doesn't say.
 */
export function billingNearAmount(text: string | undefined, amount: number): BillingBasis | undefined {
  if (!text || !Number.isFinite(amount)) return undefined;
  const variants = [...new Set([String(amount), amount.toLocaleString('en-US')])];
  let annual = false;
  let monthly = false;
  for (const v of variants) {
    const re = new RegExp(`(?<![\\d.])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.])`, 'g');
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      const nextDollar = text.indexOf('$', i + v.length);
      const end = nextDollar === -1 ? i + v.length + 120 : Math.min(i + v.length + 120, nextDollar);
      const window = text.slice(i, end);
      if (RE_BILLED_ANNUAL.test(window)) annual = true;
      if (RE_BILLED_MONTHLY.test(window)) monthly = true;
    }
  }
  if (annual && !monthly) return 'annual';
  if (monthly && !annual) return 'monthly';
  return undefined;
}

/** A tool/plan/cost question, where prices belong in the pricing node only. */
export function isPlanQuery(query: string): boolean {
  if (inferSeats(query) != null) return true;
  return /\b(pric\w*|plans?|costs?|cheap\w*|seats?|billing|per\s+seat|per\s+user|vs|versus|invoic\w*|help\s*desk|subscription)\b|under\s+\$|\/\s?seat|\/\s?user/i.test(query);
}

const PRICE_TOKEN = /(?<![\w£€])(?:US)?\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?:\s?[kK]\b)?/g;
const BUDGET_PRE = /(under|below|less than|fewer than|≤|<=|<|up to|max(?:imum)?|budget(?: of)?|cap of|within|over|above|more than)\s*$/i;

/** The number a "$1,299.99" / "US$7" / "$5k" token stands for. */
function tokenAmount(token: string): number | undefined {
  const m = /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s?([kK])?/.exec(token);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? roundMoney(n) : undefined;
}

/**
 * Drop dollar amounts that are not a budget constraint ("under $50").
 * Amounts in `keep` (sourced prices from the card's pricing table) stay.
 */
export function stripStrayPrices(text: string, keep: readonly number[] = []): string {
  const stripped = text.replace(PRICE_TOKEN, (m, offset) => {
    const pre = text.slice(Math.max(0, offset - 24), offset);
    if (BUDGET_PRE.test(pre)) return m;
    const amount = tokenAmount(m);
    return amount !== undefined && keep.includes(amount) ? m : '';
  });
  if (stripped === text) return text;
  return stripped.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/\(\s*\)/g, '').trim();
}

const STRIP_SKIP = new Set(['type', 'icon', 'href', 'url', 'src', 'query', 'prompt', 'imageQuery', 'sourceUrl', 'credit', 'image', 'imageSrc']);
const VALUE_NODES = new Set(['hero', 'stat', 'tile']);

/**
 * Remove stray dollar amounts from every node except pricing.
 * A hero/stat/tile whose whole value was a stray price shows "—" with no unit,
 * so the card never shows a bare "/user/mo".
 */
export function stripPricesDeep<T>(value: T, keep: readonly number[] = []): T {
  if (typeof value === 'string') return stripStrayPrices(value, keep) as T;
  if (Array.isArray(value)) return value.map((item) => stripPricesDeep(item, keep)) as T;
  if (!value || typeof value !== 'object') return value;
  const type = (value as { type?: string }).type;
  if (type === 'pricing') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = STRIP_SKIP.has(k) ? v : stripPricesDeep(v, keep);
  }
  const before = (value as { value?: unknown }).value;
  if (type && VALUE_NODES.has(type) && typeof before === 'string' && out.value !== before && !/\d/.test(String(out.value))) {
    out.value = '—';
    delete out.unit;
  }
  return out as T;
}

/** Sourced amounts in every pricing node of a card: the prices that show with a source link and an as-of date. */
export function pricingTableAmounts(nodes: readonly unknown[]): number[] {
  const found = new Set<number>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const node = v as { type?: string; plans?: { prices?: Price[] }[] };
    if (node.type === 'pricing') {
      for (const plan of node.plans ?? []) {
        for (const p of plan.prices ?? []) {
          if (p.amount != null && Number.isFinite(p.amount) && p.sourceUrl?.trim()) found.add(roundMoney(p.amount));
        }
      }
      return;
    }
    Object.values(v).forEach(walk);
  };
  walk(nodes);
  return [...found];
}

/**
 * Prices on a plan question's card, settled across every node (they stream in any order).
 * Once the card has a pricing table with sourced prices, a dollar amount outside the table
 * stays only if it repeats one of those sourced, dated table prices; any other amount is
 * stray and is removed. Until a sourced table exists there is nothing to move prices to,
 * so nothing is removed (product questions like "X vs Y, what do they cost?" keep their prices).
 */
export function settleCardPrices<T>(nodes: readonly (T | undefined)[], query: string): (T | undefined)[] {
  if (!isPlanQuery(query)) return [...nodes];
  const keep = pricingTableAmounts(nodes);
  if (!keep.length) return [...nodes];
  return nodes.map((n) => (n === undefined ? n : stripPricesDeep(n, keep)));
}

/** "Oct 7, 2026" from an ISO fetch date. Anything else without a real date is omitted. */
export function formatAsOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${MONTHS[month - 1]} ${day}, ${year}`;
    return undefined;
  }
  if (/\b(?:19|20)\d{2}\b/.test(s) && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s) && !/\b(?:ago|today|yesterday)\b/i.test(s)) {
    return s.slice(0, 40);
  }
  return undefined;
}

/** Title, snippet and page text, capped to the window billing is read from. */
export function priceSourceText(part: { title?: string; snippet?: string; content?: string } | undefined): string | undefined {
  if (!part) return undefined;
  const text = `${part.title ?? ''}\n${part.snippet ?? ''}\n${part.content ?? ''}`.slice(0, 2500);
  return text.trim() ? text : undefined;
}

/** Billing the source states for this amount. The model's billing stands when the page doesn't say. */
export function billingFromSources(price: Price, sources: { url: string; title?: string; snippet?: string; content?: string }[]): BillingBasis {
  if (price.amount == null || !price.sourceUrl) return price.billing;
  const hit = sources.find((s) => sameSource(s.url, price.sourceUrl!));
  return billingNearAmount(priceSourceText(hit), price.amount) ?? price.billing;
}

/** Host + path, so a cited URL matches the result it came from. */
export function sameSource(a: string, b: string): boolean {
  const norm = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
    } catch {
      return '';
    }
  };
  const left = norm(a);
  return left !== '' && left === norm(b);
}
