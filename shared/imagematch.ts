/**
 * Decides whether a picture is of one named item. Comparison pages ("X vs Y")
 * name every item they mention, so a title match alone is not enough.
 */

const STOP = new Set(['the', 'and', 'for', 'with', 'photo', 'image', 'picture', 'of', 'in', 'a', 'an', 'on', 'at', 'to']);

/** Category words a file name should not have to contain ("Kobo Clara BW eReader" → kobo, clara, bw). */
const GENERIC = new Set([
  'ereader', 'reader', 'phone', 'phones', 'smartphone', 'smartphones', 'earbuds', 'earbud',
  'headphones', 'headphone', 'laptop', 'laptops', 'tablet', 'tablets', 'review', 'reviews',
]);

export type MatchImage = { title?: string; thumb: string; alt?: string };

/** Significant words of an image query, used to check that a found picture is of that exact item. */
function keywords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of the item's words that the picture's title mentions (0-1). */
export function matchScore(query: string, title: string): number {
  const words = keywords(query);
  if (!words.length) return 1;
  const t = title.toLowerCase();
  return words.filter((w) => t.includes(w)).length / words.length;
}

/** The name part of an item ("Altra Torin 9" in "Altra Torin 9 running shoe"): capitalized words and model numbers. */
function core(query: string): string[] {
  return query.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w && !STOP.has(w.toLowerCase()) && (/^\p{Lu}/u.test(w) || /\d/.test(w))).map((w) => w.toLowerCase());
}

const hasWord = (text: string, w: string) => (w.length <= 3 ? new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text) : text.includes(w));

/**
 * A picture counts as specific when its title names the item: every word of its
 * name (brand, model, number) when the query has one, otherwise most of its words.
 */
export function matches(query: string, title: string): boolean {
  const name = core(query);
  const t = title.toLowerCase();
  // Model numbers are written with or without hyphens ("WF-1000XM5" / "WF1000XM5").
  const joined = t.replace(/([a-z0-9])[-\u2010\u2011]+(?=[a-z0-9])/g, '$1');
  if (name.length) return name.every((w) => hasWord(t, w) || hasWord(joined, w));
  return matchScore(query, title) >= (keywords(query).length <= 2 ? 1 : 0.6);
}

/** Last path segment of a thumbnail, decoded. */
function rawFile(thumb: string): string {
  const path = thumb.split(/[?#]/)[0] ?? '';
  const seg = path.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** File name with `-`, `_` and `.` read as spaces ("kobo-clara-bw.jpg" → "kobo clara bw jpg"). */
export function fileWords(thumb: string): string {
  return rawFile(thumb).replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const marker = (text: string) => /\bv\.s\b\.?/i.test(text)
  || /\b(?:vs|versus|compare|compared|comparison|comparisons|collage|lineup|line up|roundup)\b|\bside by side\b|\bhead to head\b|\bface off\b/i.test(text.toLowerCase().replace(/[-_.]+/g, ' '));

/** True when the title, alt, or file name is a comparison, collage, or side-by-side. */
export function isComposite(img: MatchImage): boolean {
  return [img.title ?? '', img.alt ?? '', rawFile(img.thumb)].some(marker);
}

const COMPARISON = /\b(?:versus|which|compar\w*)\b|\bvs\b\.?/i;
const SEP = /\s*(?:,|\bvs\b\.?|\bversus\b|\bcompared\s+(?:to|with)\b|\bor\b|\band\b)\s*/i;
const FILLER = [
  /\bwhich\s+is\s+better\b/gi,
  /\bwhich\s+should\s+i\s+buy\b/gi,
  /\bwhat\s+do\s+they\s+cost\b/gi,
  /\bshould\s+i\s+buy\b/gi,
  /\bcurrent\s+prices\b/gi,
  /\bwhich\s+one\b/gi,
  /\bhow\s+much\b/gi,
  /\bfor\s+\p{Ll}[\p{Ll}\p{N}-]*/gu,
  /\bwhich\b/gi,
];

function cleanEntity(raw: string): string {
  let t = raw.replace(/\?/g, ' ');
  for (const re of FILLER) {
    re.lastIndex = 0;
    t = t.replace(re, ' ');
  }
  return t.replace(/\s+/g, ' ').replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '').trim();
}

function looksLikeEntity(s: string): boolean {
  const words = s.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  return words.some((w) => /^\p{Lu}/u.test(w) || /\d/.test(w));
}

/**
 * Product names in a comparison question ("iPhone 17 vs Pixel 10" → both).
 * Empty when the query is not a comparison.
 */
export function splitEntities(query: string): string[] {
  const q = query.trim();
  if (!q || !COMPARISON.test(q)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of q.split(SEP)) {
    const name = cleanEntity(part);
    const key = name.toLowerCase();
    if (!name || seen.has(key) || !looksLikeEntity(name)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Same item said two ways ("Kindle" and "Kindle Paperwhite") — not a rival. */
function sameItem(a: string, b: string): boolean {
  return matches(a, b) || matches(b, a);
}

/** True when `text` names a rival of `query` from `siblings`. */
export function namesSibling(query: string, text: string, siblings: string[]): boolean {
  return siblings.some((s) => s.trim() && !sameItem(s, query) && matches(s, text));
}

/** core() words with category words removed, so a file name can match the model alone. */
function fileQuery(query: string): string {
  return query.split(/\s+/).filter((w) => !GENERIC.has(w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())).join(' ');
}

/**
 * True when the picture is of `query` and not also of a sibling.
 * A comparison page still counts when its file name alone is this item.
 */
export function fitsEntity(query: string, img: MatchImage, siblings: string[]): boolean {
  const title = img.title ?? '';
  const file = fileWords(img.thumb);
  const titleOk = matches(query, title);
  const titleBad = isComposite(img) || namesSibling(query, title, siblings);
  if (titleOk && !titleBad) return true;
  if (!titleOk || !titleBad) return false;
  // Page title is a comparison or names a rival; the file itself can still be this item.
  return matches(fileQuery(query), file) && !isComposite({ thumb: img.thumb }) && !namesSibling(query, file, siblings);
}

function extraWords(title: string, query: string): number {
  const known = new Set(keywords(query));
  return title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !known.has(w)).length;
}

/** Best unused pool picture of this item, or nothing when every candidate is someone else's. */
export function rankForEntity<T extends MatchImage>(query: string, pool: T[], siblings: string[], used: Set<string>): T | undefined {
  const fitting = pool
    .map((img, i) => ({ img, i }))
    .filter(({ img }) => img.thumb && !used.has(img.thumb) && fitsEntity(query, img, siblings));
  fitting.sort((a, b) => {
    const score = matchScore(query, b.img.title ?? '') - matchScore(query, a.img.title ?? '');
    if (score) return score;
    const extra = extraWords(a.img.title ?? '', query) - extraWords(b.img.title ?? '', query);
    if (extra) return extra;
    return a.i - b.i;
  });
  return fitting[0]?.img;
}
