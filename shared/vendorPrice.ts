/**
 * V3 vendor prices for shopping asks.
 *
 * The manufacturer's own "From $X" price becomes the main price for each product, cited
 * to the vendor page. Retailer prices stay next to it; nothing is removed, and every
 * product the card names stays on the card. When a retailer amount is more than 5% off
 * the vendor price, a visible flag ("17% below vendor") goes on the same tile, row or
 * sentence, plus a structured `priceFlag` for the client.
 */

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const GENERIC = new Set(['com', 'org', 'net', 'www', 'co', 'io', 'store', 'shop', 'www2']);

/** Longer names first so "iPad Air" wins over "iPad". `name` is the short display name. */
const BRANDS: { id: string; name: string; re: RegExp; domains: string[] }[] = [
  { id: 'ipad-air', name: 'iPad Air', re: /\bipad air\b/i, domains: ['apple.com'] },
  { id: 'ipad-pro', name: 'iPad Pro', re: /\bipad pro\b/i, domains: ['apple.com'] },
  { id: 'ipad', name: 'iPad', re: /\bipad\b(?!\s+(?:air|pro|mini)\b)/i, domains: ['apple.com'] },
  { id: 'airpods', name: 'AirPods', re: /\bairpods\b/i, domains: ['apple.com'] },
  { id: 'iphone', name: 'iPhone', re: /\biphones?\b/i, domains: ['apple.com'] },
  { id: 'macbook', name: 'MacBook', re: /\bmacbooks?\b/i, domains: ['apple.com'] },
  { id: 'kindle', name: 'Kindle', re: /\b(kindle|paperwhite)\b/i, domains: ['amazon.com'] },
  { id: 'kobo', name: 'Kobo', re: /\bkobo\b|\bclara\s?(?:bw|colour|color)\b/i, domains: ['kobo.com', 'kobobooks.com'] },
  { id: 'sony', name: 'Sony', re: /\bsony\b|\bwf-1000xm\d\b|\bwh-1000xm\d\b/i, domains: ['sony.com', 'electronics.sony.com'] },
  { id: 'bose', name: 'Bose', re: /\bbose\b|\bquietcomfort\b/i, domains: ['bose.com'] },
  { id: 'workspace', name: 'Google Workspace', re: /\bgoogle workspace\b|\bg suite\b|\bworkspace\b/i, domains: ['workspace.google.com'] },
  { id: 'pixel', name: 'Pixel', re: /\bpixel\b/i, domains: ['store.google.com'] },
  { id: 'galaxy', name: 'Galaxy', re: /\bgalaxy\b|\bsamsung\b/i, domains: ['samsung.com'] },
  { id: 'surface', name: 'Surface', re: /\bsurface\b/i, domains: ['microsoft.com'] },
  { id: 'xbox', name: 'Xbox', re: /\bxbox\b/i, domains: ['microsoft.com', 'xbox.com'] },
  { id: 'playstation', name: 'PlayStation', re: /\bplaystation\b|\bps5\b/i, domains: ['playstation.com'] },
  { id: 'nintendo', name: 'Nintendo', re: /\bnintendo\b/i, domains: ['nintendo.com'] },
  { id: 'dyson', name: 'Dyson', re: /\bdyson\b/i, domains: ['dyson.com'] },
  { id: 'sonos', name: 'Sonos', re: /\bsonos\b/i, domains: ['sonos.com'] },
  { id: 'bose-speaker', name: 'Bose SoundLink', re: /\bsoundlink\b/i, domains: ['bose.com'] },
];

const PRICE_WORD = /\b(pric(?:e|es|ed|ing)|costs?|cheap(?:er)?|buy(?:ing)?|vs|versus|how much|worth)\b/i;
const PRICE_TOKEN = /(?<![\w£€])(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d])/g;
const BUDGET_PRE = /(under|below|less than|fewer than|≤|<=|<|up to|max(?:imum)?|budget(?: of)?|cap of|within|over|above|more than)\s*$/i;
/** "From $1,199", "Starting at $599", "Starts at", "Starting from". */
const FROM_PRE = /\b(?:from|starting (?:at|from)|starts? at|beginning at|priced from)\s*$/i;
/** Not a list price: monthly plans, trade-in credit, discounts, education or refurbished prices. */
const NOT_LIST_PRE = /\b(?:trade[- ]?in|save|saving|off|credit|was|reg\.?|regularly|education|edu|student|refurbished|monthly|per month|up to)\s*(?:of\s*)?$/i;
const NOT_LIST_POST = /^\s*(?:\/\s*mo\b|\/\s*month|per month|a month|mo\.|monthly|off\b|savings|credit|with (?:eligible )?trade|after trade|in credit|back\b)/i;
/** How far after a product name a price still belongs to it. */
const NEAR = 220;
/** Store sites to look in with one call. Serper counts each as the same call. */
const MAX_SITES = 3;
const FLAG_NOTE = 'differs from vendor';

export interface VendorHit {
  domain: string;
  url?: string;
  title?: string;
  snippet?: string;
  content?: string;
}

export interface VendorPrice {
  id: string;
  /** Short product name for labels. */
  name: string;
  amount: number;
  domain: string;
  /** 1-based index into the result list (the vendor page to cite). */
  source: number;
  /** The page said "From" / "Starting at". */
  from: boolean;
}

/** Shown on a tile, hero or table row when a retailer amount is more than 5% off the vendor price. */
export interface PriceFlag {
  vendor: number;
  other: number;
  /** Rounded percent difference, always positive. */
  pct: number;
  dir: 'below' | 'above';
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function domainOk(domain: string): boolean {
  return DOMAIN.test(domain.toLowerCase());
}

export function sameHost(domain: string, official: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const o = official.toLowerCase().replace(/^www\./, '');
  return d === o || d.endsWith(`.${o}`);
}

export function brandsIn(query: string): { id: string; name: string; re: RegExp; domains: string[] }[] {
  const out = BRANDS.filter((b) => b.re.test(query));
  // "iPad Air" also matches the generic Bose/iPad rules only when that word stands alone; keep the specific one.
  return out.filter((b) => !(b.id === 'bose-speaker' && out.some((o) => o.id === 'bose')));
}

/** site:host tokens that look like real hostnames. */
export function sitesIn(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(/\bsite:([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (domainOk(host) && !out.includes(host)) out.push(host);
  }
  return out;
}

/** A planner site: guess counts only when its host label is a word in the question. */
export function plannerDomainOk(domain: string, query: string): boolean {
  if (!domainOk(domain)) return false;
  const words = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  return domain.toLowerCase().split('.').some((label) => label.length > 2 && !GENERIC.has(label) && words.has(label));
}

/** Official domains for this question: the brand map, plus a validated planner site: guess. */
export function officialDomains(query: string, extras: readonly string[] = []): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    const host = d.toLowerCase().replace(/^www\./, '');
    if (domainOk(host) && !out.some((x) => sameHost(x, host) || sameHost(host, x))) out.push(host);
  };
  for (const b of brandsIn(query)) b.domains.forEach(add);
  for (const q of [query, ...extras]) {
    for (const host of sitesIn(q)) if (plannerDomainOk(host, query)) add(host);
  }
  return out;
}

/** A product price question (Kindle vs Kobo, iPad Air vs Pro), not a general fact. */
export function isProductShopAsk(query: string): boolean {
  return brandsIn(query).length > 0 && PRICE_WORD.test(query);
}

function parseAmount(whole: string, frac?: string): number | undefined {
  const n = Number(`${whole.replace(/,/g, '')}${frac ? `.${frac}` : ''}`);
  return Number.isFinite(n) && n >= 1 ? money(n) : undefined;
}

interface Amount {
  amount: number;
  at: number;
  end: number;
  budget: boolean;
}

function amountsAt(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(new RegExp(PRICE_TOKEN.source, 'g'))) {
    const n = parseAmount(m[1], m[2]);
    if (n === undefined) continue;
    const at = m.index ?? 0;
    out.push({ amount: n, at, end: at + m[0].length, budget: BUDGET_PRE.test(text.slice(Math.max(0, at - 24), at)) });
  }
  return out;
}

/** True when the other number is more than 5% off the vendor price. */
export function differsFromVendor(amount: number, vendor: number): boolean {
  if (!(vendor > 0)) return false;
  return Math.abs(amount - vendor) > vendor * 0.05 + 1e-9;
}

export function priceFlag(other: number, vendor: number): PriceFlag | undefined {
  if (!differsFromVendor(other, vendor)) return undefined;
  return { vendor, other, pct: Math.round((Math.abs(other - vendor) / vendor) * 100), dir: other < vendor ? 'below' : 'above' };
}

export function formatUsd(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

export function flagText(flag: PriceFlag): string {
  return `${flag.pct}% ${flag.dir} vendor`;
}

interface Candidate {
  amount: number;
  from: boolean;
  /** Characters between the product name and the price; smaller is closer. */
  gap: number;
}

/**
 * The list price a vendor page states for one product. "From $X" / "Starting at $X" wins
 * over any other amount; monthly plans, trade-in credit, discounts and education prices
 * are never the list price. Among equals, the amount closest after the product name wins.
 */
export function listPriceFor(text: string, re: RegExp): { amount: number; from: boolean } | undefined {
  const finder = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const mentions = [...text.matchAll(finder)].map((m) => (m.index ?? 0) + m[0].length);
  if (!mentions.length) return undefined;
  const candidates: Candidate[] = [];
  for (const a of amountsAt(text)) {
    if (a.budget) continue;
    const pre = text.slice(Math.max(0, a.at - 40), a.at);
    const post = text.slice(a.end, a.end + 40);
    if (NOT_LIST_PRE.test(pre) || NOT_LIST_POST.test(post)) continue;
    const before = mentions.filter((m) => m <= a.at);
    if (!before.length) continue;
    const gap = a.at - before[before.length - 1];
    if (gap > NEAR) continue;
    candidates.push({ amount: a.amount, from: FROM_PRE.test(pre), gap });
  }
  if (!candidates.length) return undefined;
  candidates.sort((x, y) => (x.from === y.from ? x.gap - y.gap : x.from ? -1 : 1));
  return { amount: candidates[0].amount, from: candidates[0].from };
}

/** The price each product's own store page states, with the result to cite. */
export function vendorPrices(query: string, hits: readonly VendorHit[]): VendorPrice[] {
  const brands = brandsIn(query);
  const out: VendorPrice[] = [];
  for (const b of brands) {
    let best: VendorPrice | undefined;
    hits.forEach((hit, i) => {
      if (!b.domains.some((d) => sameHost(hit.domain, d))) return;
      // A page that never names the product is not that product's page: the iPad Air
      // page's "From $599" is not the iPad Pro price.
      const text = `${hit.title ?? ''}\n${hit.snippet ?? ''}\n${hit.content ?? ''}`;
      const found = listPriceFor(text, b.re);
      if (!found) return;
      const next: VendorPrice = { id: b.id, name: b.name, amount: found.amount, domain: hit.domain.replace(/^www\./, ''), source: i + 1, from: found.from };
      // A "From" price on a later vendor result beats a bare amount on an earlier one.
      if (!best || (!best.from && next.from)) best = next;
    });
    if (best) out.push(best);
  }
  return out;
}

function productIn(text: string, query: string): string | undefined {
  const asked = new Set(brandsIn(query).map((b) => b.id));
  const named = brandsIn(text).filter((b) => asked.has(b.id));
  if (named.length === 1) return named[0].id;
  const all = brandsIn(query);
  if (named.length === 0 && all.length === 1) return all[0].id;
  return undefined;
}

/**
 * Where each product's name starts in a sentence that names more than one of them
 * ("the Kindle is $159.99 and the Kobo is $149.99"), so an amount is matched to the
 * product it follows rather than to both at once.
 */
function productParts(text: string, query: string): { text: string; product: string }[] {
  const marks: { at: number; product: string }[] = [];
  for (const b of brandsIn(query)) {
    for (const m of text.matchAll(new RegExp(b.re.source, 'gi'))) marks.push({ at: m.index ?? 0, product: b.id });
  }
  if (!marks.length) return [{ text, product: productIn(text, query) ?? '' }];
  marks.sort((a, b) => a.at - b.at);
  const parts: { text: string; product: string }[] = [];
  if (marks[0].at > 0) parts.push({ text: text.slice(0, marks[0].at), product: '' });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    parts.push({ text: text.slice(marks[i].at, end), product: marks[i].product });
  }
  return parts;
}

/** The first non-budget amount in a string. */
function firstAmount(text: string): Amount | undefined {
  return amountsAt(text).find((a) => !a.budget);
}

/** A cite marker right after an amount ("$999 [4]"), so a note goes after the cite. */
function afterCite(text: string, end: number): number {
  const m = /^\s*(?:\[\d+\])+/.exec(text.slice(end));
  return m ? end + m[0].length : end;
}

/**
 * Prose keeps every retailer amount. The first amount per product that is more than 5%
 * off the vendor price gets the vendor price and the flag right after it.
 */
function annotateText(text: string, query: string, prices: Map<string, VendorPrice>, placed: Set<string>): string {
  if (!text.includes('$')) return text;
  const parts = productParts(text, query);
  let changed = false;
  const out = parts.map((part) => {
    const price = part.product ? prices.get(part.product) : undefined;
    if (!price) return part.text;
    const a = firstAmount(part.text);
    if (!a) return part.text;
    const flag = priceFlag(a.amount, price.amount);
    if (!flag) return part.text;
    if (part.text.includes(`[${price.source}]`) && part.text.includes(FLAG_NOTE)) return part.text;
    const at = afterCite(part.text, a.end);
    changed = true;
    placed.add(price.id);
    return `${part.text.slice(0, at)} (vendor ${vendorLabel(price)} [${price.source}], ${flagText(flag)})${part.text.slice(at)}`;
  });
  return changed ? out.join('') : text;
}

function vendorLabel(price: VendorPrice): string {
  return `${price.from ? 'From ' : ''}${formatUsd(price.amount)}`;
}

const SKIP = new Set(['actions', 'choices', 'citations', 'links', 'code', 'draft', 'slider', 'scaler', 'pricing']);
const FINISH = new Set(['citations', 'actions', 'links', 'followups']);

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

function typeOf(rec: Record<string, unknown>): string {
  return typeof rec.type === 'string' ? rec.type : '';
}

/** "Retailer $999 [4]" plus the flag, for a tile sub or hero caption. */
function retailerLine(original: string, a: Amount, price: VendorPrice): { line: string; flag?: PriceFlag } {
  const flag = priceFlag(a.amount, price.amount);
  const cite = /^\s*((?:\[\d+\])+)/.exec(original.slice(a.end))?.[1];
  const line = `Retailer ${formatUsd(a.amount)}${cite ? ` ${cite}` : ''}${flag ? ` · ${flagText(flag)}` : ''}`;
  return { line, flag };
}

/**
 * V3: every product keeps its retailer prices, the vendor's own price is the main price
 * (cited to the vendor page), and a >5% difference is flagged where the price is shown.
 * Vendor prices the card never showed are added as one "Store prices" key-value block
 * before the citations, once every streamed node is in.
 */
export function reconcileProductPrices<T>(nodes: readonly (T | undefined)[], query: string, hits: readonly VendorHit[] = []): (T | undefined)[] {
  const list = vendorPrices(query, hits);
  if (!list.length) return [...nodes];
  const prices = new Map(list.map((p) => [p.id, p]));
  const placed = new Set<string>();

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return annotateText(value, query, prices, placed);
    if (Array.isArray(value)) return value.map(visit);
    const rec = asRecord(value);
    if (!rec) return value;
    const type = typeOf(rec);
    if (SKIP.has(type)) return value;
    if (type === 'table') return visitTable(rec);
    if (type === 'tile' || type === 'stat') return visitTile(rec);
    if (type === 'hero') return visitHero(rec);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = k === 'type' ? v : visit(v);
    return out;
  };

  function visitTile(rec: Record<string, unknown>): Record<string, unknown> {
    const label = typeof rec.label === 'string' ? rec.label : '';
    const value = typeof rec.value === 'string' ? rec.value : '';
    const product = productIn(`${label} ${value}`, query);
    const price = product ? prices.get(product) : undefined;
    const a = firstAmount(value);
    if (!price || !a) {
      const out: Record<string, unknown> = { ...rec };
      if (typeof rec.sub === 'string') out.sub = annotateText(rec.sub, query, prices, placed);
      return out;
    }
    placed.add(price.id);
    const { line, flag } = retailerLine(value, a, price);
    const same = Math.abs(a.amount - price.amount) < 0.5;
    const sub = typeof rec.sub === 'string' && rec.sub.trim() ? rec.sub.trim() : '';
    const out: Record<string, unknown> = {
      ...rec,
      value: vendorLabel(price),
      source: price.source,
      vendorTrue: true,
      ...(same ? {} : { sub: sub ? `${sub} · ${line}` : line }),
    };
    if (flag) out.priceFlag = flag;
    return out;
  }

  function visitHero(rec: Record<string, unknown>): Record<string, unknown> {
    const label = typeof rec.label === 'string' ? rec.label : '';
    const value = typeof rec.value === 'string' ? rec.value : '';
    const caption = typeof rec.caption === 'string' ? rec.caption : '';
    const product = productIn(`${label} ${value} ${caption}`, query);
    const price = product ? prices.get(product) : undefined;
    const a = firstAmount(value);
    if (!price || !a) return { ...rec, ...(caption ? { caption: annotateText(caption, query, prices, placed) } : {}) };
    placed.add(price.id);
    const { line, flag } = retailerLine(value, a, price);
    const same = Math.abs(a.amount - price.amount) < 0.5;
    const vendorLine = `${price.domain} [${price.source}]${same ? '' : ` · ${line}`}`;
    const out: Record<string, unknown> = { ...rec, value: vendorLabel(price), vendorTrue: true, caption: caption ? `${vendorLine} · ${caption}` : vendorLine };
    if (flag) out.priceFlag = flag;
    return out;
  }

  function visitTable(rec: Record<string, unknown>): Record<string, unknown> {
    const columns = Array.isArray(rec.columns) ? rec.columns.map((c) => String(c)) : [];
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    const priceRows: { domain: string; vendorTrue: boolean; note?: string; flag?: PriceFlag }[] = [];
    const next = rows.map((row) => {
      if (!Array.isArray(row)) return row;
      const cells = row.map((c) => String(c));
      const offset = cells.length === columns.length + 1 ? 1 : 0;
      let meta: { domain: string; vendorTrue: boolean; note?: string; flag?: PriceFlag } = { domain: '', vendorTrue: false };
      const rewritten = cells.map((cell, i) => {
        const header = i >= offset ? columns[i - offset] ?? '' : '';
        const product = productIn(`${header} ${cells[0] ?? ''}`, query) ?? productIn(cell, query);
        const price = product ? prices.get(product) : undefined;
        const a = firstAmount(cell);
        if (!price || !a || cell.includes(`[${price.source}]`)) return annotateText(cell, query, prices, placed);
        placed.add(price.id);
        const flag = priceFlag(a.amount, price.amount);
        const same = Math.abs(a.amount - price.amount) < 0.5;
        const cite = /^\s*((?:\[\d+\])+)/.exec(cell.slice(a.end))?.[1];
        const retailer = same ? '' : ` · ${formatUsd(a.amount)}${cite ? ` ${cite}` : ''}${flag ? ` (${flagText(flag)})` : ''}`;
        meta = { domain: price.domain, vendorTrue: true, ...(flag ? { note: FLAG_NOTE, flag } : {}) };
        return `${vendorLabel(price)} [${price.source}]${retailer}`;
      });
      priceRows.push(meta);
      return rewritten;
    });
    return { ...rec, rows: next, ...(priceRows.some((r) => r.vendorTrue) ? { priceRows } : {}) };
  }

  const settled: (T | undefined)[] = nodes.map((n) => (n === undefined ? undefined : visit(n) as T));
  const missing = list.filter((p) => !placed.has(p.id));
  const complete = settled.length > 0 && settled.every((n) => n !== undefined);
  if (!missing.length || !complete) return settled;
  const block = {
    type: 'keyvalue',
    vendorPrices: true,
    items: missing.map((p) => ({ label: `${p.name} · ${p.domain}`, value: `${vendorLabel(p)} [${p.source}]`, icon: 'store' })),
  } as unknown as T;
  const at = settled.findIndex((n) => FINISH.has(typeOf(asRecord(n as unknown) ?? {})));
  const out: (T | undefined)[] = [...settled];
  out.splice(at < 0 ? out.length : at, 0, block);
  return out;
}

/**
 * Plan catalogs (Workspace per-seat) keep the P05 behaviour: when a result is already on
 * the official domain, price text cites that result. Not used for store products, where
 * retailer prices keep their own citations.
 */
export function stampOfficialPriceCite<T>(node: T, query: string, results: readonly { domain: string }[]): T {
  if (!isProductShopAsk(query)) return node;
  const domains = officialDomains(query);
  if (!domains.length) return node;
  const index = results.findIndex((r) => domains.some((d) => sameHost(r.domain, d)));
  if (index < 0) return node;
  const n = index + 1;
  const mark = `[${n}]`;
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.includes('$') || value.includes(mark)) return value;
      return `${value} ${mark}`;
    }
    if (Array.isArray(value)) return value.map(visit);
    const rec = asRecord(value);
    if (!rec) return value;
    const type = typeOf(rec);
    if (type === 'pricing') {
      const plans = Array.isArray(rec.plans) ? rec.plans.map((plan) => {
        const p = asRecord(plan);
        if (!p) return plan;
        const prices = Array.isArray(p.prices) ? p.prices.map((price) => {
          const row = asRecord(price);
          return row ? { ...row, source: n } : price;
        }) : p.prices;
        return { ...p, prices };
      }) : rec.plans;
      return { ...rec, plans };
    }
    if (SKIP.has(type)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = k === 'type' ? v : visit(v);
    return out;
  };
  return visit(node) as T;
}

/** Question words that add nothing to a store lookup. */
const FILLER = /\b(?:what|whats|which|who|whom|whose|should|would|could|can|will|shall|may|might|must|i|me|my|mine|we|our|you|your|do|does|did|done|they|them|their|he|she|it|its|this|that|these|those|is|are|was|were|be|been|being|am|a|an|the|of|for|to|and|or|with|on|in|at|by|from|as|if|then|than|so|such|there|here|out|up|down|off|about|into|onto|how|much|many|worth|cost|costs|costing|price|prices|priced|pricing|buy|buying|bought|cheap|cheaper|cheapest|best|top|deal|deals|current|currently|now|today|latest|recent|official|officially|source|sources|find|found|recommend|recommended|recommendation|guide|review|reviews|need|needs|want|wants|looking|please|thanks|give|tell|show|explain|help|vs|versus)\b/gi;
/** Months and years: they pull deal roundups instead of the store page. */
const DATED = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:19|20)\d{2}\b/gi;

/** The product words of the question, with dates and filler removed. */
export function productWords(query: string): string {
  return query
    .toLowerCase()
    .replace(DATED, ' ')
    .replace(FILLER, ' ')
    .replace(/[^\w\s$.:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One search text that keeps the lookup inside the official stores: `site:` on
 * every vendor domain of this question. It runs as one of the allowed calls, so
 * nothing extra is spent.
 */
export function vendorSiteQuery(query: string, extras: readonly string[] = []): string | undefined {
  if (!isProductShopAsk(query)) return undefined;
  const domains = officialDomains(query, extras).slice(0, MAX_SITES);
  const words = productWords(query);
  if (!domains.length || !words) return undefined;
  const sites = domains.map((d) => `site:${d}`).join(' OR ');
  return `${words} ${sites}`.slice(0, 180);
}

/** The first result that sits on one of this question's official domains. */
export function firstOfficial<T extends { domain: string; url: string }>(results: readonly T[], query: string): T | undefined {
  const domains = officialDomains(query);
  if (!domains.length) return undefined;
  return results.find((r) => domains.some((d) => sameHost(r.domain, d)));
}
