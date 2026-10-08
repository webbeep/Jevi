/**
 * V6 vendor prices: read the manufacturer's own buy page for every product a shopping ask
 * names, and name the row by the exact model the page states. Apple shop pages serve
 * schema.org JSON-LD in plain HTML, Bose carries an analytics data layer, and other hosts that
 * refuse a direct fetch are read through keyless Jina (it already honours ENGINE_SKIP /
 * tripSkip / engineDead and counts the read in the ledger). Sony is never read: keyless Jina
 * is quota-blocked from the CF edge and a direct Sony read is a 403, so a Sony ask gets no
 * vendor row. A page that states no price yields no row: a guessed price is worse than a
 * missing one.
 */

import { BROWSER_UA, isFetchable, pageText } from './pages';
import type { AskScope } from './budget';
import type { SearchResult } from '../shared/types';
import { stripHtml } from '../shared/text';
import { brandsIn, storePriceFromPage, storePriceName, storePriceLine, vendorPageTargets, type VendorTarget } from '../shared/vendorPrice';
import { readCapped, type Env } from './util';

/** Direct-fetch timeout, HTML window, and page text kept per row. */
const READ_MS = 6000;
const HTML_CAP = 700_000;
/** Only the head of the page is turned into text: the price sits near the top and CPU stays bounded. */
const HTML_TEXT_WINDOW = 40_000;
const TEXT_CAP = 6000;
/** Vendor pages are read in parallel, a few at a time. */
const CONCURRENCY = 3;

/** A vendor page read: a search result whose text is the store's own page. */
export type VendorRow = SearchResult & {
  content: string;
  /** The price the page stated (the design hint quotes it). */
  vendor?: { id: string; product: string; amount: number; from: boolean; was?: number };
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Direct fetch with a browser UA, capped so a huge page cannot run the worker out of CPU. */
async function fetchHtml(url: string): Promise<string | undefined> {
  if (!isFetchable(url)) return undefined;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US' },
      signal: AbortSignal.timeout(READ_MS),
      redirect: 'follow',
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('html') || !isFetchable(res.url || url)) return undefined;
    return await readCapped(res, HTML_CAP);
  } catch {
    return undefined;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, in order. */
async function pooled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await fn(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The page's readable text, script and style blocks dropped (they carry no prose). */
function pageTextOf(html: string): string {
  return stripHtml(html.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|aside)\b[\s\S]*?<\/\1>/gi, ' '));
}

async function readOne(target: VendorTarget, fallback: string, env: Env, scope?: AskScope): Promise<VendorRow | undefined> {
  const started = Date.now();
  const host = target.domain || hostOf(target.url);
  let via: 'ld' | 'datalayer' | 'jina' | 'none' = 'none';
  let found: ReturnType<typeof storePriceFromPage>;
  let text = '';
  const html = await fetchHtml(target.url);
  if (scope) scope.ledger.pages.direct += 1;
  if (html) {
    found = storePriceFromPage(html, 'html');
    if (found) {
      via = found.via ?? 'ld';
      text = pageTextOf(html.slice(0, HTML_TEXT_WINDOW)).slice(0, TEXT_CAP);
    }
  }
  if (!found) {
    // Keyless Jina through the ordinary reader: it honours ENGINE_SKIP / tripSkip / engineDead
    // and counts the read in the ledger itself.
    try {
      const markdown = await pageText(target.url, env, 12000, 8000, undefined, scope);
      found = storePriceFromPage(markdown, 'markdown');
      if (found) {
        via = 'jina';
        text = markdown.slice(0, TEXT_CAP);
      }
    } catch {
      /* no row */
    }
  }
  // One line per target: host and outcome only — no URLs with query strings, no keys.
  console.log(JSON.stringify({ zo: 'vendor', host, via, ok: !!found, ms: Date.now() - started }));
  if (!found) return undefined;
  const product = storePriceName(found, fallback);
  const line = storePriceLine(found, product, target.domain || host);
  return {
    title: `${product} — official store`,
    url: target.url,
    snippet: line,
    domain: target.domain || host,
    engines: ['web'],
    content: `${line}\n\n${text}`,
    vendor: { id: target.id, product, amount: found.amount, from: found.from, ...(found.was ? { was: found.was } : {}) },
  };
}

/**
 * Reads the vendor buy pages of this shopping ask and returns one row per page that stated a
 * price. `skip` holds brand ids already read: a first pass over the canonical buy URLs runs
 * while the search is still going, so a later pass only reads SERP-derived targets.
 */
export async function readVendorPages(
  query: string,
  hits: readonly { domain: string; url: string }[],
  env: Env,
  scope?: AskScope,
  skip?: readonly string[],
): Promise<VendorRow[]> {
  const done = new Set(skip ?? []);
  const names = new Map(brandsIn(query).map((b) => [b.id, b.name]));
  const targets = vendorPageTargets(query, hits).filter((t) => !done.has(t.id));
  if (!targets.length) return [];
  const rows = await pooled(targets, CONCURRENCY, (t) => readOne(t, names.get(t.id) ?? t.domain, env, scope));
  return rows.filter((row): row is VendorRow => !!row);
}
