/**
 * "How much does a Nintendo Switch 2 cost?" is answered by the maker's own price page, not a
 * resale listing. A price ask that names a brand with its own store also searches that site.
 */

const BRANDS: [RegExp, string][] = [
  [/\bnintendo\b/i, 'nintendo.com'],
  [/\b(?:apple|iphone|ipad|macbook|airpods|apple watch|vision pro)\b/i, 'apple.com'],
  [/\bpixel\b|\bgoogle (?:nest|home|tv)\b/i, 'store.google.com'],
  [/\bsamsung|galaxy\b/i, 'samsung.com'],
  [/\bplaystation|ps5\b/i, 'playstation.com'],
  [/\bxbox\b/i, 'xbox.com'],
  [/\bmeta quest\b|\boculus\b/i, 'meta.com'],
  [/\bspotify\b/i, 'spotify.com'],
  [/\bnetflix\b/i, 'netflix.com'],
  [/\bdisney\s*\+|\bdisney plus\b/i, 'disneyplus.com'],
  [/\byoutube (?:premium|tv)\b/i, 'youtube.com'],
  [/\bcostco\b/i, 'costco.com'],
  [/\bamazon prime\b/i, 'amazon.com'],
  [/\btesla\b/i, 'tesla.com'],
  [/\bdyson\b/i, 'dyson.com'],
  [/\bgarmin\b/i, 'garmin.com'],
  [/\bsonos\b/i, 'sonos.com'],
  [/\bsteam deck\b/i, 'steampowered.com'],
];

const PRICE_ASK = /\bhow much (?:does|do|is|are|would|will)\b|\b(?:price|prices|cost|costs|msrp|charge|charges)\b/i;
const FILLER = /\b(?:how|much|does|do|is|are|would|will|a|an|the|in|us|u\.s\.|usa|united states|right|now|today|currently|current|cost|costs|price|prices|what|charge|charges|for|it|of)\b/gi;

/** The maker's site to search for a price ask, with the product words to search there. Undefined for anything else. */
export function brandPriceProbe(query: string): string | undefined {
  if (!PRICE_ASK.test(query)) return undefined;
  const hit = BRANDS.find(([re]) => re.test(query));
  if (!hit) return undefined;
  const product = query.replace(/[?!.,]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (product.length < 3) return undefined;
  return `${product} price site:${hit[1]}`;
}

/** The maker's host for a probe, so its rows can be recognised among the results. */
export function probeHost(probe: string): string {
  return probe.match(/site:(\S+)/)?.[1] ?? '';
}
