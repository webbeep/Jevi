/**
 * Official-store prices for shopping asks.
 * One manufacturer domain per brand, one search call restricted to those domains,
 * and one price per product taken from that page. A third-party number that
 * disagrees is not shown as a second price.
 */

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const GENERIC = new Set(['com', 'org', 'net', 'www', 'co', 'io', 'store', 'shop', 'www2']);

/** Longer names first so "iPad Air" wins over "iPad". */
const BRANDS: { id: string; re: RegExp; domains: string[] }[] = [
  { id: 'ipad-air', re: /\bipad air\b/i, domains: ['apple.com'] },
  { id: 'ipad-pro', re: /\bipad pro\b/i, domains: ['apple.com'] },
  { id: 'ipad', re: /\bipad\b(?!\s+(?:air|pro)\b)/i, domains: ['apple.com'] },
  { id: 'airpods', re: /\bairpods\b/i, domains: ['apple.com'] },
  { id: 'iphone', re: /\biphones?\b/i, domains: ['apple.com'] },
  { id: 'macbook', re: /\bmacbooks?\b/i, domains: ['apple.com'] },
  { id: 'kindle', re: /\b(kindle|paperwhite)\b/i, domains: ['amazon.com'] },
  { id: 'kobo', re: /\bkobo\b|\bclara\s?(?:bw|colour|color)\b/i, domains: ['kobo.com', 'kobobooks.com'] },
  { id: 'sony', re: /\bsony\b|\bwf-1000xm\d\b|\bwh-1000xm\d\b/i, domains: ['sony.com', 'electronics.sony.com'] },
  { id: 'bose', re: /\bbose\b|\bquietcomfort\b/i, domains: ['bose.com'] },
  { id: 'workspace', re: /\bgoogle workspace\b|\bg suite\b|\bworkspace\b/i, domains: ['workspace.google.com'] },
  { id: 'pixel', re: /\bpixel\b/i, domains: ['store.google.com'] },
  { id: 'galaxy', re: /\bgalaxy\b|\bsamsung\b/i, domains: ['samsung.com'] },
  { id: 'surface', re: /\bsurface\b/i, domains: ['microsoft.com'] },
  { id: 'xbox', re: /\bxbox\b/i, domains: ['microsoft.com', 'xbox.com'] },
  { id: 'playstation', re: /\bplaystation\b|\bps5\b/i, domains: ['playstation.com'] },
  { id: 'nintendo', re: /\bnintendo\b/i, domains: ['nintendo.com'] },
  { id: 'dyson', re: /\bdyson\b/i, domains: ['dyson.com'] },
  { id: 'sonos', re: /\bsonos\b/i, domains: ['sonos.com'] },
  { id: 'bose-speaker', re: /\bsoundlink\b/i, domains: ['bose.com'] },
];

const PRICE_WORD = /\b(pric(?:e|es|ed|ing)|costs?|cheap(?:er)?|buy(?:ing)?|vs|versus|how much|worth)\b/i;
const PRICE_TOKEN = /(?<![\w£€])(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d])/g;
const BUDGET_PRE = /(under|below|less than|fewer than|≤|<=|<|up to|max(?:imum)?|budget(?: of)?|cap of|within|over|above|more than)\s*$/i;
const FROM_PRICE = /\bfrom\s+\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i;
/** Store sites to look in with one call. Serper counts each as the same call. */
const MAX_SITES = 3;

export interface VendorHit {
  domain: string;
  url?: string;
  title?: string;
  snippet?: string;
  content?: string;
}

export interface VendorPrice {
  id: string;
  amount: number;
  domain: string;
  /** 1-based index into the result list. */
  source: number;
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

export function brandsIn(query: string): { id: string; re: RegExp; domains: string[] }[] {
  return BRANDS.filter((b) => b.re.test(query));
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

function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(PRICE_TOKEN.source, 'g'))) {
    const n = parseAmount(m[1], m[2]);
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** True when the other number is more than 5% off the vendor price. */
export function differsFromVendor(amount: number, vendor: number): boolean {
  if (!(vendor > 0)) return false;
  return Math.abs(amount - vendor) > vendor * 0.05 + 1e-9;
}

function formatUsd(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

function priceNear(text: string, re: RegExp): number | undefined {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const finder = new RegExp(re.source, flags);
  let amount: number | undefined;
  for (const m of text.matchAll(finder)) {
    const at = (m.index ?? 0) + m[0].length;
    const window = text.slice(at, at + 180);
    const from = FROM_PRICE.exec(window);
    const picked = from ? parseAmount(from[1], from[2]) : (() => {
      const any = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(window);
      return any ? parseAmount(any[1], any[2]) : undefined;
    })();
    if (picked !== undefined) {
      amount = picked;
      break;
    }
  }
  return amount;
}

/** The price each product's own store page states, with the result to cite. */
export function vendorPrices(query: string, hits: readonly VendorHit[]): VendorPrice[] {
  const brands = brandsIn(query);
  const out: VendorPrice[] = [];
  if (!brands.length) return out;
  const texts = hits.map((hit) => `${hit.title ?? ''}\n${hit.snippet ?? ''}\n${hit.content ?? ''}`);
  for (const b of brands) {
    let found: VendorPrice | undefined;
    hits.forEach((hit, i) => {
      if (found || !b.domains.some((d) => sameHost(hit.domain, d))) return;
      const text = texts[i];
      // A page that never names the product is not that product's page: the iPad Air
      // page's "From $749" is not the iPad Pro price, so keep looking.
      const amount = priceNear(text, b.re) ?? (b.re.test(text) ? (() => {
        const head = `${hit.title ?? ''}\n${hit.snippet ?? ''}`;
        const from = FROM_PRICE.exec(head) ?? FROM_PRICE.exec(text);
        if (from) return parseAmount(from[1], from[2]);
        return amountsIn(head)[0] ?? amountsIn(text)[0];
      })() : undefined);
      if (amount === undefined) return;
      found = { id: b.id, amount, domain: hit.domain.replace(/^www\./, ''), source: i + 1 };
    });
    if (found) out.push(found);
  }
  return out;
}

function productIn(text: string, query: string): string | undefined {
  const named = brandsIn(text);
  if (named.length === 1) return named[0].id;
  const all = brandsIn(query);
  if (named.length === 0 && all.length === 1) return all[0].id;
  return undefined;
}

/** Collapses what removing a number leaves behind, and trims what a whole sentence lost. */
function squeeze(text: string, husks: boolean, trim: boolean): string {
  let out = text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1');
  if (husks) out = out.replace(/\(\s*\)/g, '');
  return trim ? out.trim() : out;
}

/**
 * Where each product's name starts in a sentence that names more than one of them
 * ("the Kindle is $159.99 and the Kobo is $149.99"), so an amount is matched to the
 * product it follows rather than to both at once.
 */
function productParts(text: string, query: string): { text: string; product: string }[] | undefined {
  const marks: { at: number; product: string }[] = [];
  for (const b of brandsIn(query)) {
    const re = new RegExp(b.re.source, 'gi');
    for (const m of text.matchAll(re)) marks.push({ at: m.index ?? 0, product: b.id });
  }
  if (marks.length < 2) return undefined;
  marks.sort((a, b) => a.at - b.at);
  const parts: { text: string; product: string }[] = [];
  let cursor = 0;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].at > cursor) parts.push({ text: text.slice(cursor, marks[i].at), product: '' });
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    parts.push({ text: text.slice(marks[i].at, end), product: marks[i].product });
    cursor = end;
  }
  return parts;
}

function rewriteMoney(text: string, product: string | undefined, prices: Map<string, VendorPrice>, seen: Set<string>, keepEdges = false): string {
  const token = new RegExp(PRICE_TOKEN.source, 'g');
  if (!token.test(text)) return text;
  token.lastIndex = 0;
  const price = product ? prices.get(product) : undefined;
  if (!price || (product && seen.has(product))) {
    const stripped = text.replace(token, (m, _a, _b, offset) => {
      const pre = text.slice(Math.max(0, offset - 24), offset);
      return BUDGET_PRE.test(pre) ? m : '';
    });
    return squeeze(stripped, true, !keepEdges);
  }
  const originals = amountsIn(text);
  const disagree = originals.some((n) => differsFromVendor(n, price.amount));
  let replaced = false;
  token.lastIndex = 0;
  const next = text.replace(token, (m, _a, _b, offset) => {
    const pre = text.slice(Math.max(0, offset - 24), offset);
    if (BUDGET_PRE.test(pre)) return m;
    if (replaced) return '';
    replaced = true;
    const cite = text.includes(`[${price.source}]`) ? '' : ` [${price.source}]`;
    const note = disagree ? ' (differs from vendor)' : '';
    return `${formatUsd(price.amount)}${cite}${note}`;
  });
  seen.add(product!);
  return squeeze(next, false, !keepEdges);
}

/** One store price per product inside one string, whether it names one product or several. */
function rewritePrices(text: string, forced: string | undefined, query: string, prices: Map<string, VendorPrice>, seen: Set<string>): string {
  if (forced) return rewriteMoney(text, forced, prices, seen);
  const parts = productParts(text, query);
  if (!parts) return rewriteMoney(text, productIn(text, query), prices, seen);
  return squeeze(parts.map((part) => rewriteMoney(part.text, part.product, prices, seen, true)).join(''), true, true);
}

const SKIP = new Set(['actions', 'choices', 'citations', 'links', 'code', 'draft', 'slider', 'scaler']);

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

/** One vendor price per product. Without a store price, dollar amounts are removed. */
export function reconcileProductPrices<T>(nodes: readonly (T | undefined)[], query: string, hits: readonly VendorHit[] = []): (T | undefined)[] {
  const prices = new Map(vendorPrices(query, hits).map((p) => [p.id, p]));
  const seen = new Set<string>();

  const visit = (value: unknown, forced?: string): unknown => {
    if (typeof value === 'string') return rewritePrices(value, forced, query, prices, seen);
    if (Array.isArray(value)) return value.map((item) => visit(item, forced));
    const rec = asRecord(value);
    if (!rec) return value;
    const type = typeof rec.type === 'string' ? rec.type : '';
    if (SKIP.has(type)) return value;
    if (type === 'table') return visitTable(rec);
    if (type === 'tile' || type === 'stat' || type === 'hero') return visitLabeled(rec, 'label');
    if (type === 'keyvalue') {
      const items = Array.isArray(rec.items) ? rec.items.map((item) => {
        const row = asRecord(item);
        return row ? visitLabeled(row, 'label') : item;
      }) : rec.items;
      return { ...rec, items };
    }
    if (type === 'pricing') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = visit(v, forced);
    return out;
  };

  function visitLabeled(rec: Record<string, unknown>, labelKey: string): Record<string, unknown> {
    const label = typeof rec[labelKey] === 'string' ? rec[labelKey] : '';
    const product = productIn(`${label} ${typeof rec.value === 'string' ? rec.value : ''}`, query);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'value' || k === 'sub' || k === 'caption' || k === 'text') out[k] = typeof v === 'string' ? rewritePrices(v, product, query, prices, seen) : visit(v, product);
      else if (k === 'children' || k === 'items') out[k] = visit(v, product);
      else out[k] = v;
    }
    const price = product ? prices.get(product) : undefined;
    if (price && seen.has(product!) && typeof out.value === 'string' && out.value.includes('$')) {
      out.vendorTrue = true;
      out.source = price.source;
      if (typeOf(rec) === 'tile' || typeOf(rec) === 'stat') {
        const whole = `${out.value} ${out.sub ?? ''}`;
        if (whole.includes('differs from vendor') && typeof out.value === 'string' && typeof out.sub === 'string' && !out.sub.includes('differs from vendor')) {
          out.sub = `${out.sub} · differs from vendor`;
          out.value = out.value.replace(/\s*\(differs from vendor\)/, '');
        }
      }
    }
    if (typeof out.value === 'string' && out.value === '' && typeof rec.value === 'string' && /\$/.test(rec.value)) out.value = 'Check store';
    return out;
  }

  function visitTable(rec: Record<string, unknown>): Record<string, unknown> {
    const columns = Array.isArray(rec.columns) ? rec.columns.map((c) => String(c)) : [];
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    const priceRows: { domain: string; vendorTrue: boolean; note?: string }[] = [];
    const next = rows.map((row) => {
      if (!Array.isArray(row)) return row;
      const cells = row.map((c) => String(c));
      const offset = cells.length === columns.length + 1 ? 1 : cells.length === columns.length && columns.length > 1 ? 1 : 0;
      let note: string | undefined;
      let domain = '';
      let vendorTrue = false;
      const rewritten = cells.map((cell, i) => {
        if (i < offset) return rewritePrices(cell, undefined, query, prices, seen);
        const header = columns[i - offset] ?? '';
        const product = productIn(`${header} ${cells[0] ?? ''}`, query);
        const before = cell;
        const after = rewritePrices(cell, product, query, prices, seen);
        const price = product ? prices.get(product) : undefined;
        if (price && product && after.includes('$') && seen.has(product)) {
          vendorTrue = true;
          domain = price.domain;
          if (amountsIn(before).some((n) => differsFromVendor(n, price.amount)) || after.includes('differs from vendor')) note = 'differs from vendor';
        }
        return after;
      });
      priceRows.push(vendorTrue ? { domain, vendorTrue: true, note } : { domain: domain || '', vendorTrue: false });
      return rewritten;
    });
    const keepMeta = priceRows.some((r) => r.vendorTrue);
    return { ...rec, rows: next, ...(keepMeta ? { priceRows } : {}) };
  }

  return nodes.map((n) => (n === undefined ? n : visit(n) as T));
}

function typeOf(rec: Record<string, unknown>): string {
  return typeof rec.type === 'string' ? rec.type : '';
}

/**
 * When a result is already on the official domain, price text cites that result.
 * The number stays; a roundup citation is not removed here.
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
    if (SKIP.has(type)) return value;
    if (type === 'pricing') {
      const plans = Array.isArray(rec.plans) ? rec.plans.map((plan) => {
        const p = asRecord(plan);
        if (!p) return plan;
        const list = Array.isArray(p.prices) ? p.prices.map((price) => {
          const row = asRecord(price);
          return row ? { ...row, source: n } : price;
        }) : p.prices;
        return { ...p, prices: list };
      }) : rec.plans;
      return { ...rec, plans };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = visit(v);
    return out;
  };
  return visit(node) as T;
}

/** Question words that add nothing to a store lookup. */
const FILLER = /\b(?:what|whats|which|who|whom|whose|should|would|could|can|will|shall|may|might|must|i|me|my|mine|we|our|you|your|do|does|did|done|they|them|their|he|she|it|its|this|that|these|those|is|are|was|were|be|been|being|am|a|an|the|of|for|to|and|or|with|on|in|at|by|from|as|if|then|than|  so|such|there|here|out|up|down|off|about|into|onto|how|much|many|worth|cost|costs|costing|price|prices|priced|pricing|buy|buying|bought|cheap|cheaper|cheapest|best|top|deal|deals|current|currently|now|today|latest|recent|official|officially|source|sources|find|found|recommend|recommended|recommendation|guide|review|reviews|need|needs|want|wants|looking|please|thanks|give|tell|show|explain|help)\b/gi;
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
 * every vendor domain of this question. Serper runs it as one of the three
 * allowed calls, so nothing extra is spent.
 */
export function vendorSiteQuery(query: string, extras: readonly string[] = []): string | undefined {
  if (!isProductShopAsk(query)) return undefined;
  const domains = officialDomains(query, extras).slice(0, MAX_SITES);
  const words = productWords(query);
  if (!domains.length || !words) return undefined;
  const sites = domains.map((d) => `site:${d}`).join(' or ');
  return `${sites} ${words}`.slice(0, 180);
}

/** The first result that sits on one of this question's official domains. */
export function firstOfficial<T extends { domain: string; url: string }>(results: readonly T[], query: string): T | undefined {
  const domains = officialDomains(query);
  if (!domains.length) return undefined;
  return results.find((r) => domains.some((d) => sameHost(r.domain, d)));
}
