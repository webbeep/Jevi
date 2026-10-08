/**
 * V6 vendor prices for shopping asks.
 *
 * The manufacturer's own store price is confirmed, never substituted. A node that names the
 * exact product and already shows the vendor amount (cited to the vendor page) is marked
 * `vendorTrue`; an empty price slot is filled from the vendor page; a vendor price the card
 * never showed is added as one "Store prices" block. Every other number stays exactly as the
 * designer wrote it: a wrong price is worse than a missing one.
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
/**
 * Not a list price: monthly plans, trade-in credit, discounts, education or refurbished
 * prices, and the "list $Y" half of a store's own sale line (the sale amount wins).
 */
const NOT_LIST_PRE = /\b(?:trade[- ]?in|save|saving|off|credit|was|reg\.?|regularly|education|edu|student|refurbished|monthly|per month|up to|list)\s*(?:of\s*)?$/i;
const NOT_LIST_POST = /^\s*(?:\/\s*mo\b|\/\s*month|per month|a month|mo\.|monthly|off\b|savings|credit|with (?:eligible )?trade|after trade|in credit|back\b)/i;
/** A store price outside this range is a plan, an accessory or a parse error. */
const AMOUNT_MIN = 1;
const AMOUNT_MAX = 20000;
/** How far after a product name a price still belongs to it. */
const NEAR = 220;
/** Store sites to look in with one call. Serper counts each as the same call. */
const MAX_SITES = 3;
/** Vendor buy pages read for one ask (each brand gets its own page). */
const MAX_TARGETS = 4;

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
  /**
   * The product the vendor page itself names, read off its store-price line
   * ("iPad Pro 11-inch (M5): From $1,199 …"). It carries the variant the price is for.
   */
  model?: string;
  amount: number;
  domain: string;
  /** 1-based index into the result list (the vendor page to cite). */
  source: number;
  /** The page said "From" / "Starting at". */
  from: boolean;
  /** The store's own list price, when the amount is a sale price. */
  was?: number;
}

/** A price read off a vendor page (server/vendorPages.ts), with the page's product name. */
export interface StorePrice {
  name?: string;
  amount: number;
  from: boolean;
  /** The list price the page states next to a sale amount. */
  was?: number;
  /** Which part of the page stated it (server log only). */
  via?: 'ld' | 'datalayer';
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

export function formatUsd(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

/**
 * Not a price for the product itself: a retailer, deal, service, plan or accessory word.
 * A node or cell that carries one is never the vendor's own price for the product.
 */
const EXCLUDED = /\b(amazon|best ?buy|walmart|target|costco|b&h|ebay|swappa|mashable|iclarified|backmarket|retail(?:er)?|deal|lowest|best price|tracked|used|refurb\w*|renewed|open[- ]box|repair|screen|replacement|applecare|warranty|insurance|trade[- ]?in|credit|subscription|plus|unlimited|plan|monthly|\/mo|per month|education|student|edu|case|cover|pencil|keyboard|accessor\w*|discount|save|off)\b/i;

/** A size token: "13-inch", '11"', "9.7 in". */
const SIZE = /(\d+(?:\.\d+)?)\s*(?:-?\s*inch|in\b|"|”|″)/i;
/** The suffixes that make a number a size rather than a model number. */
const SIZE_AFTER = /^\s*(?:-?\s*inch|in\b|"|”|″)/i;
const CHIP = /\b(M\d)\b/gi;
const GENERATION = /\b(\d+)(?:st|nd|rd|th)[\s-]*gen(?:eration)?\b/gi;
const CONNECTIVITY = /\b(cellular|5G|LTE)\b/gi;
/** A model code, e.g. WF-1000XM5. */
const MODEL_CODE = /\b([A-Z]{2}-?\d{3,4}[A-Z]{2}\d)\b/gi;

type Variant = 'size' | 'chip' | 'generation' | 'storage' | 'connectivity' | 'code' | 'model';

const brandOf = (price: VendorPrice) => BRANDS.find((b) => b.id === price.id);

/** The first value a pattern states, so "128GB" and "128 GB" agree. */
function firstValue(text: string, re: RegExp): string | undefined {
  const finder = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(finder)) {
    const v = (m[1] ?? m[0]).trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * A model number right after the family name ("AirPods Pro 3" → 3). "iPad Pro 13-inch" is a
 * size, not a model number, so the number only counts when no size suffix follows it; the
 * digits of a chip ("M5") are not a model number either.
 */
function familyModel(text: string, brand: RegExp): string | undefined {
  const m = brand.exec(text);
  if (!m) return undefined;
  const at = (m.index ?? 0) + m[0].length;
  const rest = text.slice(at, at + 24);
  const num = /^\s*(?:[a-z]+\s+){0,2}?(?<![\w$])(\d+(?:\.\d+)?)/i.exec(rest);
  if (!num) return undefined;
  if (SIZE_AFTER.test(rest.slice(num[0].length))) return undefined;
  return num[1]!;
}

/** Every variant a string states, normalised so "13-inch" and 13" agree. */
function variantsOf(text: string, brand: RegExp): Map<Variant, string> {
  const out = new Map<Variant, string>();
  if (!text) return out;
  const size = firstValue(text, SIZE);
  if (size) out.set('size', String(Number(size)));
  const chip = firstValue(text, CHIP);
  if (chip) out.set('chip', chip.toUpperCase());
  const generation = firstValue(text, GENERATION);
  if (generation) out.set('generation', String(Number(generation)));
  const storage = /\b(\d+)\s?(GB|TB)\b/i.exec(text);
  if (storage) out.set('storage', `${storage[1]}${storage[2]!.toUpperCase()}`);
  const connection = firstValue(text, CONNECTIVITY);
  if (connection) out.set('connectivity', connection.toLowerCase());
  const code = firstValue(text, MODEL_CODE);
  if (code) out.set('code', code.toUpperCase().replace(/-/g, ''));
  const model = familyModel(text, brand);
  if (model) out.set('model', String(Number(model)));
  return out;
}

/**
 * Every variant the node states must be the one the vendor row's model states. A kind only
 * the model states (an 11-inch page for a plain "iPad Pro" node) is fine; a kind the node
 * states and the model does not (a 13-inch tile, a 128GB cell) is a different product.
 */
/**
 * Product-line words: "AirPods Max" is not "AirPods Pro 3", "QC Ultra Headphones" is not
 * "QuietComfort Ultra Earbuds". Every one the node states must be in the vendor row's model.
 */
const LINE_WORD = /\b(pro|max|air|mini|ultra|plus|lite|se|earbuds?|headphones?|buds|speaker|paperwhite|clara|oasis|scribe|colorsoft|kids|signature|bw|colou?r)\b/gi;

function lineWords(text: string): Set<string> {
  return new Set([...text.matchAll(LINE_WORD)].map((m) => m[1]!.toLowerCase().replace(/^(earbud|headphone)s$/, '$1').replace('colour', 'color')));
}

/** A string naming two sizes, chips, generations or model codes is not one product. */
function statesTwo(text: string): boolean {
  for (const re of [SIZE, CHIP, GENERATION, MODEL_CODE]) {
    const finder = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const seen = new Set([...text.matchAll(finder)].map((m) => String(m[1] ?? m[0]).trim().toUpperCase().replace(/-/g, '')));
    if (seen.size > 1) return true;
  }
  return false;
}

function sameVariants(text: string, price: VendorPrice): boolean {
  const brand = brandOf(price);
  if (!brand) return false;
  if (statesTwo(text)) return false;
  const model = lineWords(price.model ?? price.name);
  for (const word of lineWords(text)) if (!model.has(word)) return false;
  const mine = variantsOf(text, brand.re);
  if (!mine.size) return true;
  const theirs = variantsOf(price.model ?? '', brand.re);
  for (const [kind, value] of mine) if (theirs.get(kind) !== value) return false;
  return true;
}

/**
 * The exact model a brand was asked about: the Sony model code of the question
 * ("Sony WF-1000XM5"), else the brand's own name. Sony has no vendor page to read
 * (see `vendorBuyUrl`), so this is what a card is told is missing for it.
 */
export function askedModelName(id: string, name: string, query: string): string {
  const code = /\bw([fh])-?(\d{3,4}xm\d)\b/i.exec(query);
  return id === 'sony' && code ? `Sony W${code[1]!.toUpperCase()}-${code[2]!.toUpperCase()}` : name;
}

/**
 * Exact product identity: the text itself must name `price.id`'s brand — never the question's
 * only brand — state no retailer, deal, service or accessory word, and state only the
 * variants the vendor row's own model states.
 */
export function sameProduct(text: string, price: VendorPrice): boolean {
  const brand = brandOf(price);
  if (!brand || !brand.re.test(text)) return false;
  if (EXCLUDED.test(text)) return false;
  return sameVariants(text, price);
}

/**
 * A tile, stat or hero is that product when its own label and value name it (`sameProduct`)
 * and its sub or caption states no other variant: "Apple Pencil ready" is prose about the
 * node, while a "13-inch" in it is not.
 */
function nodeIsProduct(price: VendorPrice, name: string, full: string): boolean {
  return sameProduct(name, price) && sameVariants(full, price);
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
    const from = FROM_PRE.test(pre);
    const gap = a.at - before[before.length - 1];
    // "From $X" on modern Apple pages sits far below the product heading — allow a longer window.
    if (gap > (from ? NEAR * 4 : NEAR)) continue;
    candidates.push({ amount: a.amount, from, gap });
  }
  if (!candidates.length) return undefined;
  candidates.sort((x, y) => (x.from === y.from ? x.gap - y.gap : x.from ? -1 : 1));
  return { amount: candidates[0].amount, from: candidates[0].from };
}


/** True when the URL path is this product's own page (not a sibling named on it). */
function urlOwnsBrand(url: string, id: string): boolean {
  const path = url.toLowerCase();
  if (id === 'ipad-pro') return /ipad[_-]?pro/.test(path);
  if (id === 'ipad-air') return /ipad[_-]?air/.test(path);
  if (id === 'airpods') return /airpods/.test(path);
  if (id === 'sony') return /w[fh]-?1000xm\d|sony/.test(path);
  if (id === 'bose') return /quietcomfort|bose/.test(path);
  const b = BRANDS.find((x) => x.id === id);
  return !!b && b.re.test(path.replace(/[-_/]/g, ' '));
}

/**
 * The manufacturer's own BUY page for a product named in the question, model-specific
 * (the marketing page carries no price). Undefined rather than a guess: a page that
 * prices a sibling product writes the wrong "From $X" into the wrong row.
 */
export function vendorBuyUrl(id: string, query: string): string | undefined {
  if (id === 'ipad-pro') return 'https://www.apple.com/shop/buy-ipad/ipad-pro';
  if (id === 'ipad-air') return 'https://www.apple.com/shop/buy-ipad/ipad-air';
  if (id === 'ipad') return 'https://www.apple.com/shop/buy-ipad/ipad';
  if (id === 'airpods') {
    if (/airpods\s*pro/i.test(query)) return 'https://www.apple.com/shop/buy-airpods/airpods-pro-3';
    if (/airpods\s*max/i.test(query)) return 'https://www.apple.com/shop/buy-airpods/airpods-max';
    if (/airpods\s*4/i.test(query)) return 'https://www.apple.com/shop/buy-airpods/airpods-4';
    return undefined;
  }
  // Sony pages read through the keyless reader are quota-blocked from the edge and 403 a
  // direct read, so Sony gets no vendor page: a missing price beats a wrong one.
  if (id === 'sony') return undefined;
  if (id === 'bose') {
    if (!/ultra/i.test(query)) return undefined;
    // Earbuds first: a Sony WF model in the same ask is the earbud SKU, a WH model the headphone one.
    if (/\b(ear ?buds|buds)\b/i.test(query) || /wf-?1000xm\d/i.test(query)) return 'https://www.bose.com/p/earbuds/bose-quietcomfort-ultra-earbuds-2nd-gen/QCUE2-HEADPHONEIN.html';
    if (/\bheadphones?\b/i.test(query) || /wh-?1000xm\d/i.test(query)) return 'https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones-2nd-gen/QCUH2-HEADPHONEARN.html';
    return undefined;
  }
  if (id === 'kobo' && /clara\s?bw/i.test(query)) return 'https://us.kobobooks.com/products/kobo-clara-bw';
  return undefined;
}

/** A vendor page to read for one product of this ask. */
export interface VendorTarget {
  id: string;
  url: string;
  /** Host without www. */
  domain: string;
}

/**
 * The buy page to read for every product of this ask: the canonical vendor BUY page when
 * there is one, else a SERP hit on the vendor's domain whose path owns that product.
 * Each compared product gets its own page, so no sibling's price lands in its row. Sony is
 * never read (see `vendorBuyUrl`), so it also never comes back from a SERP hit.
 */
export function vendorPageTargets(query: string, hits: readonly { domain: string; url: string }[]): VendorTarget[] {
  const out: VendorTarget[] = [];
  const seen = new Set<string>();
  const add = (id: string, url: string, domain: string) => {
    const key = url.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, url, domain });
  };
  for (const b of brandsIn(query)) {
    if (b.id === 'sony') continue;
    const buy = vendorBuyUrl(b.id, query);
    if (buy) {
      try {
        add(b.id, buy, new URL(buy).hostname.replace(/^www\./, ''));
      } catch {
        /* ignore */
      }
      continue;
    }
    const pathHit = hits.find((h) => b.domains.some((d) => sameHost(h.domain, d)) && urlOwnsBrand(h.url, b.id));
    if (pathHit) add(b.id, pathHit.url, pathHit.domain.replace(/^www\./, ''));
  }
  return out.slice(0, MAX_TARGETS);
}

/** A store-price line: "iPad Pro 11-inch (M5): From $1,199 on apple.com (…)". */
const STORE_LINE = /^([^:\n]{1,80}):\s+(?:From\s+)?(?:US)?\$/i;

/** The product a vendor row's store-price line names ("iPad Pro 11-inch (M5)"). */
function storeLineModel(hit: VendorHit): string | undefined {
  for (const part of [hit.snippet, hit.content]) {
    if (!part) continue;
    const line = (part.split('\n')[0] ?? '').trim();
    const m = STORE_LINE.exec(line);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** The price each product's own store page states, with the result to cite. */
export function vendorPrices(query: string, hits: readonly VendorHit[]): VendorPrice[] {
  const brands = brandsIn(query);
  const out: VendorPrice[] = [];
  for (const b of brands) {
    let best: VendorPrice | undefined;
    hits.forEach((hit, i) => {
      if (!b.domains.some((d) => sameHost(hit.domain, d))) return;
      // A sibling product's own page ( /ipad-pro/ while asking for Air) must not donate its From price.
      const ownedBy = BRANDS.find((x) => urlOwnsBrand(hit.url ?? '', x.id));
      if (ownedBy && ownedBy.id !== b.id) return;
      // A page that never names the product is not that product's page: the iPad Air
      // page's "From $599" is not the iPad Pro price.
      const text = `${hit.title ?? ''}\n${hit.snippet ?? ''}\n${hit.content ?? ''}`;
      let found = listPriceFor(text, b.re);
      // Dedicated product URL (/ipad-pro/, /airpods-pro/) — treat the page as that product even
      // when the "From $X" line sits far from the name heading.
      if (!found || !found.from) {
        if (urlOwnsBrand(hit.url ?? '', b.id)) {
          const prefixed = `${b.name}\n${text}`;
          const again = listPriceFor(prefixed, b.re);
          if (again && (!found || (again.from && !found.from) || again.amount === found.amount)) found = again;
          else if (again && again.from) found = again;
        }
      }
      if (!found) return;
      const was = storeLineWas(hit);
      const model = storeLineModel(hit);
      const next: VendorPrice = {
        id: b.id,
        name: b.name,
        amount: found.amount,
        domain: hit.domain.replace(/^www\./, ''),
        source: i + 1,
        from: found.from,
        // The exact model the page prices, when its store-price line names it.
        ...(model ? { model } : {}),
        // A store's own sale line carries its list price; the sale amount stays the price.
        ...(was !== undefined && was > found.amount ? { was } : {}),
      };
      // A "From" price on a later vendor result beats a bare amount on an earlier one.
      if (!best || (!best.from && next.from)) best = next;
    });
    if (best) out.push(best);
  }
  return out;
}

/**
 * The list price a store's own price line states ("... (official store sale price; list $399.99)").
 * Read from the line's start, so a "$399.99" elsewhere in the page is never taken as the list price.
 */
function storeLineWas(hit: VendorHit): number | undefined {
  for (const part of [hit.snippet, hit.content]) {
    if (!part) continue;
    const line = part.split('\n')[0] ?? '';
    const m = /\blist\s+(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(line);
    if (!m) continue;
    const n = num(m[1]!);
    if (amountOk(n)) return n;
  }
  return undefined;
}

/** The first non-budget amount in a string. */
function firstAmount(text: string): Amount | undefined {
  return amountsAt(text).find((a) => !a.budget);
}

function saleNote(price: VendorPrice): string | undefined {
  return price.was && price.was > price.amount ? `Sale · list ${formatUsd(price.was)}` : undefined;
}

const SKIP = new Set(['actions', 'choices', 'citations', 'links', 'code', 'draft', 'slider', 'scaler', 'pricing']);
const FINISH = new Set(['citations', 'actions', 'links', 'followups']);

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

function typeOf(rec: Record<string, unknown>): string {
  return typeof rec.type === 'string' ? rec.type : '';
}

/**
 * Copy that says the sources carry no price. Once a vendor price is on the card it
 * contradicts what the person is looking at, so it is dropped (V5 P07/P08).
 */
const MISSING_PRICE = /\b(?:prices?|pricing|costs?)\b[^.]{0,60}\b(?:not|n't|no|missing|unavailable|absent)\b[^.]{0,40}\bsources?\b|\bno (?:current )?prices?\b[^.]{0,40}\bsources?\b|\bsources?\b[^.]{0,40}\b(?:don't|do not|doesn't|does not|never)\b[^.]{0,30}\b(?:list|state|give|include|mention)\b[^.]{0,30}\bprices?\b/i;

/** Sentences of a text node that claim the sources have no price. */
function dropMissingSentences(text: string): string {
  const kept = text.split(/(?<=[.!?])\s+/).filter((s) => s && !MISSING_PRICE.test(s));
  return kept.join(' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Drops the "prices not in sources" copy from a card that shows prices: the whole callout
 * node, and the matching sentences of a text node.
 */
/** A dropped node keeps its slot as an empty stack: `undefined` would read as a region still being designed. */
const DROPPED = { type: 'stack', children: [] } as const;

function dropMissingPriceCopy<T>(nodes: readonly (T | undefined)[]): (T | undefined)[] {
  return nodes.map((node) => dropMissingNode(node)).map((node, i) => (node === undefined && nodes[i] !== undefined ? DROPPED as unknown as T : node));
}

function dropMissingNode<T>(node: T | undefined): T | undefined {
  const rec = asRecord(node);
    if (!rec) return node;
    const type = typeOf(rec);
    if (type === 'callout') {
      const title = typeof rec.title === 'string' ? rec.title : '';
      const text = typeof rec.text === 'string' ? rec.text : '';
      return MISSING_PRICE.test(title) || MISSING_PRICE.test(text) ? undefined : node;
    }
    if (type === 'text' && typeof rec.text === 'string') {
      const next = dropMissingSentences(rec.text);
      if (next === rec.text) return node;
      return next ? ({ ...rec, text: next } as T) : undefined;
    }
    if (Array.isArray(rec.children)) {
      const children = (rec.children as unknown[]).map((c) => dropMissingNode(c)).filter((c) => c !== undefined);
      return { ...rec, children } as T;
    }
    return node;
}

function vendorLabel(price: VendorPrice): string {
  return `${price.from ? 'From ' : ''}${formatUsd(price.amount)}`;
}

/** A price slot that says "no price" instead of naming one: an em dash, "Not stated", "Check store". */
const EMPTY_PATTERN = /^\s*(?:—|–|-|n\/a|not (?:stated|listed|available)|check (?:the )?store|unknown|tbd)?\s*$/i;
/** A table row or column that carries the price, and nothing else. */
const PRICE_LABEL = /^\s*(?:price|cost|msrp|list price|starting price|official price)\s*$/i;
/** How close a node's own amount must be to the vendor amount to be the vendor price. */
const SAME_AMOUNT = 0.5;

/** The node already cites the vendor result: its source, or a [n] marker in value or caption. */
function citesVendor(rec: Record<string, unknown>, texts: readonly string[], price: VendorPrice): boolean {
  if (rec.source === price.source) return true;
  return texts.some((t) => t.includes(`[${price.source}]`));
}

/**
 * V6: the vendor's own store price is confirmed, never substituted. A tile, stat or hero that
 * names the exact product and already shows the vendor amount cited to the vendor page is
 * marked `vendorTrue`; a price slot with no amount is filled from the vendor page; a table
 * cell is filled only when its row or column says "Price" and names the product. Everything
 * else — retailer amounts, other configs, repair, trade-in and subscription numbers — keeps
 * its own number, untouched. Vendor prices the card never showed become one "Store prices"
 * block before the citations, once every streamed node is in, and once any vendor price is on
 * the card the "prices not in sources" copy is dropped.
 */
export function reconcileProductPrices<T>(nodes: readonly (T | undefined)[], query: string, hits: readonly VendorHit[] = []): (T | undefined)[] {
  const list = vendorPrices(query, hits);
  if (!list.length) return [...nodes];
  const placed = new Set<string>();
  /** Amounts a node of that product already shows, so the store prices block never repeats one. */
  const shown = new Map<string, Set<number>>();

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    const rec = asRecord(value);
    if (!rec) return value;
    const type = typeOf(rec);
    if (SKIP.has(type)) return value;
    if (type === 'table') return visitTable(rec);
    if (type === 'tile' || type === 'stat' || type === 'hero') return visitValue(rec);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = k === 'type' ? v : visit(v);
    return out;
  };

  /** The amounts of `text` that a node of this product already shows. */
  function recordShown(price: VendorPrice, matched: boolean, text: string): void {
    if (!matched) return;
    const amounts = shown.get(price.id) ?? new Set<number>();
    for (const a of amountsAt(text)) amounts.add(a.amount);
    shown.set(price.id, amounts);
  }

  function visitValue(rec: Record<string, unknown>): Record<string, unknown> {
    const label = typeof rec.label === 'string' ? rec.label : '';
    const value = typeof rec.value === 'string' ? rec.value : '';
    const note = typeof rec.sub === 'string' ? rec.sub : typeof rec.caption === 'string' ? rec.caption : '';
    // The node's own name and number identify the product; its sub/caption only narrows the variant.
    const identity = `${label} ${value}`;
    const full = note.trim() ? `${identity} ${note}` : identity;
    const a = firstAmount(value);
    for (const price of list) {
      const matched = nodeIsProduct(price, identity, full);
      recordShown(price, matched, value);
      if (!matched) continue;
      // Mark: the node already shows the vendor amount, cited to the vendor page.
      if (a && Math.abs(a.amount - price.amount) < SAME_AMOUNT && citesVendor(rec, [value, note], price)) {
        placed.add(price.id);
        return { ...rec, vendorTrue: true };
      }
      // Fill: a price slot with no amount at all.
      if (!a && EMPTY_PATTERN.test(value)) {
        placed.add(price.id);
        return { ...rec, value: vendorLabel(price), source: price.source, vendorTrue: true };
      }
    }
    return { ...rec };
  }

  function visitTable(rec: Record<string, unknown>): Record<string, unknown> {
    const columns = Array.isArray(rec.columns) ? rec.columns.map((c) => String(c)) : [];
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    const priceRows: { domain: string; vendorTrue: boolean }[] = [];
    const next = rows.map((row) => {
      if (!Array.isArray(row)) return row;
      const cells = row.map((c) => String(c));
      const offset = cells.length === columns.length + 1 ? 1 : 0;
      const head = cells[0] ?? '';
      // Row-per-attribute layout: the row's first cell says "Price" and the column names the product.
      const rowIsPrice = PRICE_LABEL.test(head);
      let meta: { domain: string; vendorTrue: boolean } = { domain: '', vendorTrue: false };
      const rewritten = cells.map((cell, i) => {
        const header = i >= offset ? columns[i - offset] ?? '' : '';
        // Row-per-product layout: the column header says "Price" and the row's first cell names the product.
        const headerIsPrice = PRICE_LABEL.test(header) && i > 0;
        for (const price of list) {
          const matched = (rowIsPrice && sameProduct(header, price)) || (headerIsPrice && sameProduct(head, price));
          recordShown(price, matched, cell);
          // A cell with any amount, or any other text, is never touched.
          if (!matched || !EMPTY_PATTERN.test(cell)) continue;
          placed.add(price.id);
          meta = { domain: price.domain, vendorTrue: true };
          return `${vendorLabel(price)} [${price.source}]`;
        }
        return cell;
      });
      priceRows.push(meta);
      return rewritten;
    });
    return { ...rec, rows: next, ...(priceRows.some((r) => r.vendorTrue) ? { priceRows } : {}) };
  }

  const settled: (T | undefined)[] = nodes.map((n) => (n === undefined ? undefined : visit(n) as T));
  const complete = settled.length > 0 && settled.every((n) => n !== undefined);
  const missing = list.filter((p) => !placed.has(p.id) && !shown.get(p.id)?.has(p.amount));
  let out: (T | undefined)[] = [...settled];
  let blocked = false;
  if (missing.length && complete) {
    const block = {
      type: 'keyvalue',
      vendorPrices: true,
      items: missing.map((p) => ({ label: `${p.model ?? p.name} · ${p.domain}`, value: `${vendorLabel(p)} [${p.source}]${saleNote(p) ? ` · ${saleNote(p)}` : ''}`, icon: 'store' })),
    } as unknown as T;
    const at = out.findIndex((n) => FINISH.has(typeOf(asRecord(n as unknown) ?? {})));
    out.splice(at < 0 ? out.length : at, 0, block);
    blocked = true;
  }
  // V6: a vendor price is on the card, so "Prices not in sources" copy contradicts what is on screen.
  if (blocked || placed.size > 0) out = dropMissingPriceCopy(out);
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

function amountOk(n: number): boolean {
  return Number.isFinite(n) && n >= AMOUNT_MIN && n <= AMOUNT_MAX;
}

function num(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

const LD_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** JSON-LD script bodies of an HTML page, attribute order aside. */
function ldJsonBlocks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(LD_SCRIPT)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(m[1] ?? '')) continue;
    out.push(m[2] ?? '');
  }
  return out;
}

/** Product nodes of a parsed JSON-LD document (`@graph` and arrays included). */
function ldProducts(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const rec = asRecord(v);
    if (!rec) return;
    const type = rec['@type'];
    const types = Array.isArray(type) ? type.map((t) => String(t)) : typeof type === 'string' ? [type] : [];
    if (types.some((t) => t === 'Product' || t === 'ProductGroup')) out.push(rec);
    if (rec['@graph'] !== undefined) walk(rec['@graph']);
  };
  walk(value);
  return out;
}

/** USD prices an `offers` value states (single offer, array, or AggregateOffer low/high). */
function offerPrices(offers: unknown): number[] {
  const list = Array.isArray(offers) ? offers : [offers];
  const out: number[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const currency = typeof rec.priceCurrency === 'string' ? rec.priceCurrency.trim().toUpperCase() : '';
    if (currency && currency !== 'USD') continue;
    for (const key of ['price', 'lowPrice', 'highPrice'] as const) {
      const raw = rec[key];
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? num(raw) : NaN;
      if (amountOk(n)) out.push(n);
    }
  }
  return out;
}

/** The price a store's HTML states: schema.org JSON-LD first, the analytics data layer second. */
function fromHtml(raw: string): StorePrice | undefined {
  for (const block of ldJsonBlocks(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    for (const product of ldProducts(parsed)) {
      const prices = offerPrices(product.offers);
      if (!prices.length) continue;
      const name = typeof product.name === 'string' ? product.name.trim() : '';
      return { ...(name ? { name } : {}), amount: Math.min(...prices), from: new Set(prices).size > 1, via: 'ld' };
    }
  }
  // No Offer JSON-LD (Bose): the analytics data layer carries item_name and price.
  const layer = /"item_name"\s*:\s*"([^"]{1,200})"[\s\S]{0,600}?"price"\s*:\s*(\d+(?:\.\d+)?)/.exec(raw);
  if (layer) {
    const amount = Number(layer[2]);
    if (amountOk(amount)) return { name: layer[1], amount, from: false, via: 'datalayer' };
  }
  return undefined;
}

/** An amount is only a price when nothing before it says "Save"/"trade-in" and nothing after it says "/mo". */
function markdownAmount(raw: string, m: RegExpExecArray): number | undefined {
  const at = m.index ?? 0;
  const end = at + m[0].length;
  const pre = raw.slice(Math.max(0, at - 32), at);
  if (/\b(?:save|saved|saving|trade[- ]?in|off|credit|per month|monthly)\s*$/i.test(pre)) return undefined;
  const post = raw.slice(end, end + 32);
  if (/^\s*(?:\/\s*(?:mo|month)|per month|a month|mo\.\b|monthly)/i.test(post)) return undefined;
  const n = num(m[1] ?? '');
  return amountOk(n) ? n : undefined;
}

/** The price a Jina markdown read states: a sale amount (with its list price), else "From $X". */
function fromMarkdown(raw: string): StorePrice | undefined {
  const sale = /Sale\s*Price\s*[^\n$]{0,24}?(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw)
    ?? /Sale\s*Price\s*\n+\s*(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw);
  if (sale) {
    const amount = markdownAmount(raw, sale);
    if (amount !== undefined) {
      const list = /Original\s*Price\s*~*\s*(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw);
      const was = list ? num(list[1]!) : NaN;
      return { amount, from: false, ...(amountOk(was) && was > amount ? { was } : {}) };
    }
  }
  const from = /\b(?:From|Starting at|Starts at)\s*(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw)
    ?? /\b(?:From|Starting|Starts)\s*\n+\s*(?:US)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw);
  if (from) {
    const amount = markdownAmount(raw, from);
    if (amount !== undefined) return { amount, from: true };
  }
  return undefined;
}

/**
 * The price one vendor page states. HTML: schema.org JSON-LD offers (Apple shop pages),
 * then the analytics data layer (Bose). Markdown (Jina): a sale price with its list price,
 * else "From $X". Undefined when the page states no price — never a guess.
 */
export function storePriceFromPage(raw: string, kind: 'html' | 'markdown'): StorePrice | undefined {
  if (!raw) return undefined;
  return kind === 'html' ? fromHtml(raw) : fromMarkdown(raw);
}

/**
 * The product name a store page states for itself, when it is this product's page — so a
 * vendor row is named by its exact model ("iPad Pro 11-inch (M5)") rather than by family.
 */
export function storePriceName(p: StorePrice, productName: string): string {
  const brand = BRANDS.find((b) => b.re.test(productName));
  const named = (p.name ?? '').trim();
  return brand && named && brand.re.test(named) ? named : productName;
}

/**
 * One line naming the product, its store price and the store, e.g.
 * `iPad Pro 11-inch (M5): From $1,199 on apple.com (official store price)`.
 * It starts with the product name so `listPriceFor` picks the amount up for it, and never
 * claims "Prices not in sources": a card that shows this line has a priced source.
 */
export function storePriceLine(p: StorePrice, productName: string, domain: string): string {
  const head = storePriceName(p, productName);
  const note = p.was && p.was > p.amount ? `sale price; list ${formatUsd(p.was)}` : 'price';
  return `${head}: ${p.from ? 'From ' : ''}${formatUsd(p.amount)} on ${domain} (official store ${note})`;
}

export function firstOfficial<T extends { domain: string; url: string }>(results: readonly T[], query: string): T | undefined {
  const domains = officialDomains(query);
  if (!domains.length) return undefined;
  return results.find((r) => domains.some((d) => sameHost(r.domain, d)));
}
