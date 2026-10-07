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
