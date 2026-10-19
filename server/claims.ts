import type { CardNode } from '../shared/card';
import { SENTENCE_BREAK, citedSentences, joinSpacedDecimals, withoutIdentifiers } from '../shared/text';
import { factAnswer } from './hops';
import { numberTokens } from './ground';
import { completeCutDecimal, withoutEmptySlots } from './polish';
import { dropInventedTitles, finishQuotedText, honestHero, honestStudyText, peerPaperItems, peerPaperSource } from './cardAgree';
import { figureClause, leadFigure, moneyClauses } from './thinSource';

/** One search result, numbered the way the card cites it, with the text the card was allowed to use. */
export interface ClaimSource {
  n: number;
  text: string;
  /** Host the citation points at, when the result has one. */
  domain?: string;
  /** Title and snippet. A fetched page can omit a figure the search result stated for the thing asked. */
  stated?: string;
}

const FREE = 2;
const SHOPPING = /(?:^|\b)(?:best|top|cheap|budget|affordable)\b/i;
const PRODUCT = /(?:\$\s?\d|\b(?:buy|price|prices|deal|deals|laptop|phone|tablet|headphone|monitor|camera|keyboard|tv|shoe)s?\b)/i;
/** "Best ways to…" is advice. "Best HDMI cable" is a product list even when the noun is not in a list. */
const ADVICE = /\b(?:ways|tips|practices|methods|reasons|ideas|strategies|habits)\b/i;
const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
const BUDGET = /\b(?:under|below|less than|cheaper than|up to|at most)\b/i;
const TAX_ASK = /\b(?:sales\s+tax|tax)\b/i;
const FEE_ASK = /\b(?:fee|fees|fine|fines|toll|tolls|duty|duties|surcharge|levy|levies)\b/i;
const FEE_GENERIC = new Set(['what', 'whats', 'how', 'much', 'does', 'the', 'fee', 'fees', 'cost', 'costs', 'price', 'for', 'are', 'pay', 'paid', 'current', 'official', 'today', 'this', 'that', 'with', 'from', 'your', 'have', 'need', 'when', 'where', 'which']);
const PRICE_STOP = new Set(['best', 'top', 'under', 'with', 'for', 'the', 'and', 'laptop', 'laptops', 'buy', 'cheap', 'budget', 'new', 'from', 'than', 'that', 'this']);
/** Shared accessory nouns. They sit next to someone else's price and are not a product's name. */
const PRICE_GENERIC = new Set(['cable', 'cables', 'cord', 'cords', 'adapter', 'adapters', 'wire', 'wires', 'case', 'cases', 'cover', 'covers', 'plug', 'plugs', 'item', 'model']);

/** Dollar ceilings the question set ("under $800"). Those are not a product's price. */
export function budgetAmounts(query: string): number[] {
  const out: number[] = [];
  const re = /\b(?:under|below|less than|cheaper than|up to|at most|max(?:imum)?)\s+\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{2})?/gi;
  for (const match of query.matchAll(re)) out.push(Number(match[1]!.replace(/,/g, '')));
  return out;
}

function moneyValue(raw: string): number {
  return Number(raw.replace(/[^\d.]/g, ''));
}

/** The next price in `text` that is not the question's budget ceiling. */
function priced(text: string, ceilings: readonly number[]): string | undefined {
  const re = new RegExp(`(?:under|below|less than|up to|at most)?\\s*${MONEY.source}`, 'gi');
  for (const match of text.matchAll(re)) {
    const raw = match[0].match(MONEY)?.[0];
    if (!raw) continue;
    const value = moneyValue(raw);
    const lead = match[0].slice(0, match[0].toLowerCase().indexOf('$'));
    // "under $200" is a ceiling, not what the product costs, even when the ask's ceiling is different.
    if (BUDGET.test(lead)) continue;
    const cap = ceilings.length ? Math.min(...ceilings) : undefined;
    if (cap !== undefined && value > cap) continue;
    return raw.replace(/\s/g, '');
  }
  return undefined;
}

export function claimSources(
  results: readonly { title?: string; snippet?: string; content?: string; domain?: string }[],
  pages: readonly { n: number; text: string }[],
): ClaimSource[] {
  const page = new Map(pages.map((item) => [item.n, item.text]));
  return results.map((result, index) => {
    const read = page.get(index + 1);
    const stated = `${result.title ?? ''} ${result.snippet ?? ''}`.trim();
    // A fetched page is the citation. The snippet is kept aside so a figure it states for the
    // thing asked is not dropped when the page read misses that sentence.
    const text = read
      ? `${result.title ?? ''}\n${read}`
      : `${stated} ${result.content ?? ''}`;
    return { n: index + 1, text, domain: result.domain, stated: read ? stated : undefined };
  });
}

export function shoppingAsk(query: string): boolean {
  if (ADVICE.test(query) || TAX_ASK.test(query)) return false;
  // "Find an HDMI switch under $40" is a shopping ask without the word "best".
  const pricedProduct = budgetAmounts(query).length > 0 && PRODUCT.test(query);
  if (!SHOPPING.test(query) && !pricedProduct) return false;
  if (PRODUCT.test(query) || pricedProduct) return true;
  return !/^(?:how|why|what|who|when|where)\b/i.test(query.trim());
}

function significant(text: string): string[] {
  // "19th" is an ordinal label. Stripping the digits leaves a hole ("th century").
  const quantities = withoutIdentifiers(text).replace(/\[\d+\]/g, '').replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ');
  return numberTokens(quantities).filter((num) => Number(num) > FREE);
}

function has(source: ClaimSource | undefined, num: string): boolean {
  return !!source && numberTokens(source.text).includes(num);
}

function byNumber(sources: readonly ClaimSource[], n: number): ClaimSource | undefined {
  return sources.find((source) => source.n === n);
}

function covers(source: ClaimSource | undefined, nums: readonly string[]): boolean {
  return !!source && nums.every((num) => has(source, num));
}

function bestPage(nums: readonly string[], sources: readonly ClaimSource[], prefer: readonly number[]): number | undefined {
  let best: number | undefined;
  let score = 0;
  let preferred = false;
  for (const source of sources) {
    const found = nums.filter((num) => has(source, num)).length;
    if (!found) continue;
    const pref = prefer.includes(source.n);
    if (found > score || (found === score && pref && !preferred)) {
      best = source.n;
      score = found;
      preferred = pref;
    }
  }
  return best;
}

/** "2300" matches 2300 and 2,300. A decimal is matched as written. */
function shownNumber(num: string): RegExp {
  if (num.includes('.')) return new RegExp(`\\$?\\s*${num.replace('.', '\\.')}\\s?%?`, 'g');
  const groups: string[] = [];
  let rest = num;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return new RegExp(`\\$?\\s*${groups.join(',?')}(?:\\.0+)?\\s?%?`, 'g');
}

/** A figure as written, never part of a larger number: "4" is not in "4,970", "70" is not in "1970". */
function figureIn(num: string, prefix = '', suffix = ''): RegExp {
  return new RegExp(`(?<![\\d.,])${prefix}${shownNumber(num).source}${suffix}(?!\\d|[.,]\\d)`, 'g');
}

const AGENCY_SKIP = new Set(['AM', 'PM', 'US', 'UK', 'EU', 'UN', 'TV', 'ID', 'OK', 'NBA', 'NFL', 'MLB', 'NHL', 'GDP', 'USD', 'EUR', 'CEO', 'CFO', 'PDF', 'FAQ', 'DIY', 'GPS', 'HDMI', 'USB']);

function agencyTokens(label: string): string[] {
  return [...label.matchAll(/\b[A-Z]{2,8}\b/g)].map((match) => match[1] ?? match[0]).filter((token) => !AGENCY_SKIP.has(token));
}

function hostHasAgency(source: ClaimSource | undefined, token: string): boolean {
  return !!source?.domain && source.domain.toLowerCase().includes(token.toLowerCase());
}

/**
 * A figure labeled with an agency ("DNR", "CDC") keeps that label only when the
 * cited page is that agency. A news page that mentions the number is not the agency.
 */
function withoutForeignAgency(label: string, source: ClaimSource | undefined): string {
  if (!source?.domain) return label;
  let out = label;
  for (const token of agencyTokens(label)) {
    if (hostHasAgency(source, token)) continue;
    const named = new RegExp(`\\b${token}\\b(?:'s)?\\s*[,:—–-]?\\s*(?:\\d{4}|survey|report|estimate|study|studies|data|figures?)`, 'i');
    const clause = new RegExp(`\\b(?:according to|per|from|cited by)\\s+(?:the\\s+)?(?:[A-Za-z]+\\s+){0,3}${token}(?:'s)?(?:\\s+(?:latest|recent|annual|new|current))?(?:\\s+(?:estimate|survey|report|study|studies|data|figures?))?`, 'i');
    const exact = new RegExp(`^${token}$`, 'i').test(label.trim());
    if (!named.test(out) && !clause.test(out) && !exact) continue;
    out = out.replace(clause, ' ').replace(new RegExp(`\\b${token}\\b(?:'s)?`, 'i'), ' ');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/,\s*(?=\[)/g, ' ').replace(/^[,:—–-]+\s*/, '').replace(/\s{2,}/g, ' ').trim();
}

/** The digits of a shown number, without the money or percent wrappers. */
function bareNumber(num: string): string {
  return shownNumber(num).source.replace(/^\\\$\?\\s\*/, '').replace(/\\s\?%?\??$/, '');
}

/** A quotation is the source's words. Mask it so a missing number outside it is not pulled out of the quote. */
function maskQuotes(text: string): { text: string; quotes: string[] } {
  const quotes: string[] = [];
  const masked = text.replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, (quote) => {
    quotes.push(quote);
    return `\uE000${quotes.length - 1}\uE001`;
  });
  return { text: masked, quotes };
}

function unmaskQuotes(text: string, quotes: readonly string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => quotes[Number(index)] ?? '');
}

/** A unit written on a number ("6.3″", "256 GB", "120-nit", "48 MP"). It means nothing once the number goes. */
const UNIT_AFTER = String.raw`(?:\s?-?(?:inch(?:es)?|mm|cm|km|kg|lbs?|oz|g|GB|TB|MB|mAh|Wh|W|Hz|kHz|MHz|GHz|nits?|MP|fps|ms|hours?|hrs?|days?|mins?|minutes?|mph|°[CF]?|x)\b|\s?[″"°])?`;

function stripInPlace(text: string, nums: readonly string[]): string {
  // "6.3″ · 256 GB · 8 GB RAM": a spec line loses the whole item whose number went, not just the digits.
  const items = text.split(/\s+[·•|]\s+/);
  if (items.length >= 2) {
    const kept = items.filter((item) => !nums.some((num) => figureIn(num).test(maskQuotes(item).text)));
    if (kept.length < items.length) return kept.length ? stripNums(kept.join(' · '), nums) : '';
  }
  const masked = maskQuotes(text);
  let out = masked.text;
  for (const num of nums) {
    const bare = bareNumber(num);
    // "A 2024 imaging" loses the year and must not stay "A imaging". Only the article that sat on that number goes.
    out = out.replace(new RegExp(`\\bA\\s+${bare}\\s+(?=[aeiou])`, 'gi'), '');
    out = out.replace(new RegExp(`\\bAn\\s+${bare}\\s+(?=[bcdfghjklmnpqrstvwxyz])`, 'gi'), '');
    // The currency sign before it and the unit after it go with the number ("the £ Amazon price", "-nit display"),
    // and so does the word that only pointed at it ("in 1906 became" is "became", not "in became").
    const figure = figureIn(num, '(?:[€£¥]\\s?)?', UNIT_AFTER).source;
    out = out.replace(new RegExp(`\\b(?:in|on|since|by|during|until|from)\\s+${figure}(?=[\\s,.;:!?)]|$)`, 'gi'), ' ');
    out = out.replace(new RegExp(figure, 'g'), ' ');
  }
  out = unmaskQuotes(out, masked.quotes);
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim();
  // "no scores for October,." and "University of Paris," lose the comma that led to the removed figure.
  out = out.replace(/,+\s*([.;:!?])/g, '$1').replace(/^[,;:\s]+/, '').replace(/[,;:]+$/, '').trim();
  return withoutEmptySlots(out);
}

const YEAR = /^(?:19|20)\d\d$/;

/**
 * Takes out figures no source backs. A year goes in place ("DNR 2025" is "DNR", "In 2021 he founded" is "He founded"),
 * so the fact beside it stays. Any other figure takes its whole sentence or spec item with it: "Friday, Oct. in the
 * finale", "at ppi" and a price tile reading "Under" are broken, and a competitor never shows half a sentence.
 * A sentence with a quotation keeps its quoted words and loses only the figure.
 */
export function stripNums(text: string, nums: readonly string[]): string {
  const figures = nums.filter((num) => !YEAR.test(num));
  const holds = (part: string) => figures.some((num) => figureIn(num).test(maskQuotes(part).text));
  // "Sales tax is 4% ($6)": an aside in parentheses goes on its own and the sentence stays.
  text = text.replace(/\s*\([^()]*\)/g, (aside) => (holds(aside) ? '' : aside));
  const items = text.split(/\s+[·•|]\s+/);
  if (items.length >= 2) return stripInPlace(items.filter((item) => !holds(item)).join(' · '), nums);
  const sentences = joinSpacedDecimals(text).split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  const kept = sentences.filter((sentence) => !holds(sentence) || maskQuotes(sentence).quotes.length > 0);
  return kept.length ? stripInPlace(kept.join(' '), nums) : '';
}

/** A number the sources imply: an age, a rounded quotient, a century, the newest score, the event's year. */
function keepsDerived(query: string, text: string, sources: readonly ClaimSource[]): boolean {
  if (!query || !text) return false;
  const answer = factAnswer(query, sources.map((source) => source.text).join('\n'));
  if (!answer) return false;
  const lower = text.toLowerCase();
  return [answer.lead, ...(answer.accept ?? [])].some((value) => lower.includes(value.toLowerCase()));
}

/**
 * A quotation that stops on the whole part of a decimal ("reaching 1.") is finished from the
 * source sentence that continues it ("1.5°C"). The number is the source's, not a stored figure.
 */
function repairCutQuote(text: string, sources: readonly ClaimSource[]): string {
  const openAt = Math.max(text.lastIndexOf('"'), text.lastIndexOf('“'), text.lastIndexOf('«'));
  if (openAt < 0) return text;
  const opener = text[openAt]!;
  const closer = opener === '“' ? '”' : opener === '«' ? '»' : '"';
  const inside = text.slice(openAt + 1);
  if (inside.includes(closer)) return text;
  const cut = inside.match(/^(.*?)(\d+)\.?\s*$/);
  if (!cut?.[1] || !cut[2]) return text;
  const lead = cut[1].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length > 2).slice(-5);
  if (lead.length < 3) return text;
  for (const source of sources) {
    const low = source.text.toLowerCase();
    let pos = 0;
    for (const word of lead) {
      const next = low.indexOf(word, pos);
      if (next < 0) {
        pos = -1;
        break;
      }
      pos = next + word.length;
    }
    if (pos < 0) continue;
    const after = source.text.slice(pos, pos + 48);
    const found = after.match(new RegExp(`(?:^|\\s)(${cut[2]}\\.\\d+)(\\s?°[CF]|\\s?%)?`));
    if (!found || found.index === undefined || found.index > 24) continue;
    const tail = `${found[1]}${found[2] ?? ''}`.trim();
    const prefix = text.slice(0, openAt + 1 + cut[1].length);
    return `${prefix}${tail}${closer}`;
  }
  return text;
}

/** Point each cited number at a page that contains it, and drop a number no cited page states. */
export function retargetCites(text: string, sources: readonly ClaimSource[], query = ''): string {
  const joined = repairCutQuote(finishQuotedText(query, joinSpacedDecimals(text), sources), sources);
  if (!sources.length) return withoutEmptySlots(joined);
  if (!/\d/.test(joined)) return withoutEmptySlots(joined);
  const parts = citedSentences(joined);
  return parts.flatMap((sentence) => {
    const asked = new Set(numberTokens(query));
    // A number inside a quotation stays, even when the rest of the sentence loses a figure the page does not state.
    const nums = significant(maskQuotes(sentence).text).filter((num) => !asked.has(num));
    if (!nums.length) return [sentence];
    const cites = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    if (cites.length && cites.every((n) => covers(byNumber(sources, n), nums))) return [withoutEmptySlots(sentence)];
    const page = sources.find((source) => covers(source, nums))?.n ?? bestPage(nums, sources, cites);
    if (!page) {
      if (keepsDerived(query, sentence, sources)) return [sentence];
      if (query && nums.every((num) => sources.some((source) => statedForAsk(source, num, query)))) return [sentence];
      const bare = stripNums(sentence.replace(/\s*\[\d+\]/g, ''), nums);
      return bare ? [bare] : [];
    }
    const missing = nums.filter((num) => !has(byNumber(sources, page), num));
    const bare = stripNums(sentence.replace(/\s*\[\d+\]/g, ''), missing);
    return bare ? [`${bare.replace(/\s*\[\d+\]\s*$/, '').trim()} [${page}]`] : [];
  }).join(' ');
}

export function priceFor(name: string, sources: readonly ClaimSource[], ceilings: readonly number[] = []): { price: string; n: number } | undefined {
  const head = (name.split(/[(\[]/)[0] ?? name);
  const words = head.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !PRICE_STOP.has(word) && !PRICE_GENERIC.has(word));
  if (!words.length) return undefined;
  // The longest token is the one a page uses to name this product. A missing shorter token
  // ("HDMI" beside "MonoPrice cable") must not hide the price, and a generic noun must not take it.
  const lead = words.reduce((best, word) => (word.length > best.length ? word : best));
  let found: { price: string; n: number } | undefined;
  for (const source of sources) {
    const low = source.text.toLowerCase();
    const at = low.indexOf(lead);
    if (at < 0) continue;
    const after = priced(source.text.slice(at, at + 180), ceilings);
    const before = priced(source.text.slice(Math.max(0, at - 24), at), ceilings);
    const raw = after ?? before;
    if (!raw) continue;
    found = { price: raw, n: source.n };
    if (after) break;
  }
  return found;
}

function hasPrice(text: string | undefined, ceilings: readonly number[]): boolean {
  if (!text || !MONEY.test(text)) return false;
  if (BUDGET.test(text)) {
    const amounts = [...text.matchAll(new RegExp(MONEY.source, 'g'))].map((match) => moneyValue(match[0]));
    if (amounts.length && amounts.every((amount) => ceilings.includes(amount))) return false;
  }
  return true;
}

const ASK_STOP = new Set([
  'what', 'when', 'where', 'which', 'does', 'did', 'how', 'many', 'much', 'that', 'this', 'with', 'from', 'have',
  'been', 'were', 'will', 'your', 'about', 'into', 'over', 'under', 'than', 'then', 'them', 'they', 'their',
  'there', 'these', 'those', 'would', 'could', 'should', 'just', 'like', 'also', 'only', 'most', 'some', 'such',
  'very', 'more', 'less', 'best', 'need', 'want', 'make', 'give', 'tell', 'show', 'find', 'help', 'using',
  'used', 'according', 'quote', 'exact', 'line', 'page', 'says', 'said',
]);

/** Where `num` is written in `text`, so a nearby subject can be checked. -1 when the digits are not there. */
function numberAt(text: string, num: string): number {
  const match = shownNumber(num).exec(text);
  return match?.index ?? -1;
}

/**
 * The search result states `num` next to the thing the question asks about.
 * A snippet number with no tie to that subject does not count.
 */
function statedForAsk(source: ClaimSource | undefined, num: string, query: string): boolean {
  const stated = source?.stated;
  if (!stated || !query.trim() || !numberTokens(stated).includes(num)) return false;
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !ASK_STOP.has(word)))];
  if (!words.length) return false;
  const at = numberAt(stated, num);
  const low = stated.toLowerCase();
  const window = at < 0 ? low : low.slice(Math.max(0, at - 96), at + num.length + 96);
  const near = words.filter((word) => window.includes(word)).length;
  const need = words.length === 1 ? 1 : Math.min(2, words.length);
  return near >= need;
}

function citeValue(text: string, sources: readonly ClaimSource[], current: number | undefined, query = ''): number | undefined {
  const nums = significant(text);
  if (!nums.length) return current;
  if (current && covers(byNumber(sources, current), nums)) return current;
  const page = sources.find((source) => covers(source, nums))?.n;
  if (page) return page;
  if (query) {
    const stated = sources.find((source) => nums.every((num) => statedForAsk(source, num, query)));
    if (stated) return stated.n;
  }
  return current && nums.some((num) => has(byNumber(sources, current), num)) ? current : undefined;
}

function fillPrices(node: CardNode, sources: readonly ClaimSource[], ceilings: readonly number[]): CardNode {
  switch (node.type) {
    case 'list': {
      const items = node.items.map((item) => {
        if (hasPrice(item.meta, ceilings) || hasPrice(item.text, ceilings)) return item;
        const found = priceFor(item.text, sources, ceilings);
        if (!found) return item;
        return { ...item, meta: found.price, source: item.source ?? found.n };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'tile': {
      if (hasPrice(node.value, ceilings) || hasPrice(node.sub, ceilings) || hasPrice(node.label, ceilings)) return node;
      const found = priceFor(node.value || node.label, sources, ceilings);
      if (!found) return node;
      if (!node.value) return { ...node, value: found.price, source: node.source ?? found.n };
      return { ...node, sub: node.sub ? `${found.price} · ${node.sub}` : found.price, source: node.source ?? found.n };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => fillPrices(child, sources, ceilings)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => fillPrices(child, sources, ceilings)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'hero':
    case 'stat':
    case 'keyvalue':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

const QUOTED = /"([^"]{12,400})"|“([^”]{12,400})”/g;
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where `span` sits in a source, matched word by word so spacing and curly quotes do not matter. */
function findSpan(span: string, sources: readonly ClaimSource[]): { text: string; start: number; end: number } | undefined {
  const words = span.replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}'%$.,;:-]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return undefined;
  const re = new RegExp(words.map((word) => escapeRe(word.replace(/[.,;:]+$/, ''))).join('[^\\p{L}\\p{N}]+'), 'iu');
  for (const source of sources) {
    const text = source.text.replace(/[‘’]/g, "'");
    const hit = re.exec(text);
    if (hit) return { text, start: hit.index, end: hit.index + hit[0].length };
  }
  return undefined;
}

/** The sentence of `text` around [start, end), or undefined when it runs too long to be one quoted line. */
function sentenceAround(text: string, start: number, end: number): string | undefined {
  const reach = 220;
  const lo = Math.max(0, start - reach);
  const last = [...text.slice(lo, start).matchAll(/[.!?]\s+|\n/g)].at(-1);
  const from = last ? lo + last.index! + last[0].length : lo === 0 ? 0 : undefined;
  if (from === undefined) return undefined;
  const after = text.slice(end, end + reach);
  const stop = after.search(/[.!?](?=\s|$)/);
  const to = stop >= 0 ? end + stop + 1 : end + reach >= text.length ? text.length : undefined;
  if (to === undefined) return undefined;
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

const quoteWords = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").split(/[^\p{L}\p{N}%$'.]+/u).map((w) => w.replace(/\.$/, '')).filter((w) => w.length > 2);

/** The source sentence a slightly reworded quote came from: nearly all its words, in a sentence not much longer. */
function nearestSentence(span: string, sources: readonly ClaimSource[]): string | undefined {
  const want = quoteWords(span);
  if (want.length < 6) return undefined;
  let best: { sentence: string; score: number } | undefined;
  for (const source of sources) {
    for (const raw of source.text.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.replace(/\s+/g, ' ').trim();
      if (sentence.length > span.length * 1.6 + 20 || sentence.length > 400) continue;
      const have = new Set(quoteWords(sentence));
      const score = want.filter((word) => have.has(word)).length / want.length;
      if (score >= 0.85 && (!best || score > best.score)) best = { sentence, score };
    }
  }
  return best?.sentence;
}

/**
 * A quotation is the source's own whole sentence. A quoted fragment found in a source becomes that full
 * sentence ("Americans, adults need…" → the guideline's line). Words in quote marks that no source states
 * are a paraphrase, so the marks go. A quote node keeps its text when no source can be checked.
 */
export function wholeQuotes(text: string, sources: readonly ClaimSource[], quoteNode = false): string {
  if (!sources.length) return text;
  if (quoteNode) {
    const bare = text.replace(/^["“]|["”]$/g, '');
    const at = findSpan(bare, sources);
    const whole = at && sentenceAround(at.text, at.start, at.end);
    return whole && whole.length < 400 && whole.length >= bare.length ? whole : text;
  }
  return text.replace(QUOTED, (all, plain: string | undefined, curly: string | undefined) => {
    const span = (plain ?? curly ?? '').trim();
    if (/\.\.\.|…/.test(span)) return all;
    const at = findSpan(span, sources);
    if (!at) {
      // A reworded line becomes the sentence the source wrote; words no source states lose their quote marks.
      const near = nearestSentence(span, sources);
      if (near) return all[0] === '"' ? `"${near}"` : `“${near}”`;
      return span.split(/\s+/).length >= 6 ? span : all;
    }
    const whole = sentenceAround(at.text, at.start, at.end);
    if (!whole || whole.length > 400 || whole.length <= span.length) return all;
    return all[0] === '"' ? `"${whole}"` : `“${whole}”`;
  });
}

function retargetNode(node: CardNode, sources: readonly ClaimSource[], query = ''): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => retargetNode(child, sources, query)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => retargetNode(child, sources, query)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft': {
      // A draft is writing the person asked for: its times and amounts are theirs, not facts to check against pages.
      const cited = node.type === 'draft' ? node.text : retargetCites(wholeQuotes(node.text, sources, node.type === 'quote'), sources, query);
      const cleaned = cited.split(SENTENCE_BREAK).map((sentence) => {
        const n = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])).at(-1);
        return withoutForeignAgency(sentence, byNumber(sources, n ?? 0));
      }).join(' ');
      const text = dropInventedTitles(query, honestStudyText(query, cleaned, sources), sources);
      if (!text) return cleaned ? { type: 'stack', direction: 'col', gap: 'sm', children: [] } : { ...node, text: '' };
      return text === node.text ? node : { ...node, text };
    }
    case 'heading': {
      const cited = retargetCites(node.text, sources, query);
      const text = dropInventedTitles(query, honestStudyText(query, cited, sources), sources);
      if (!text) return cited ? { type: 'stack', direction: 'col', gap: 'sm', children: [] } : { ...node, text: '' };
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const face = honestHero(query, node, sources);
      const caption = face.caption ? completeCutDecimal(retargetCites(face.caption, sources, query), [face.value, face.label]) : face.caption;
      const nums = significant(face.value);
      const page = citeValue(face.value, sources, undefined, query);
      if (!page && keepsDerived(query, face.value, sources)) {
        return caption === face.caption ? face : { ...face, caption };
      }
      if (!page) {
        const stripped = nums.length ? stripNums(face.value, nums) : face.value;
        const value = stripped && /\d/.test(stripped) ? stripped : nums.length ? '' : face.value;
        return value === face.value && caption === face.caption ? face : { ...face, value, caption };
      }
      const already = caption ? [...caption.matchAll(/\[(\d+)\]/g)].some((match) => Number(match[1]) === page) : false;
      const next = already ? caption : `${caption ? `${caption.replace(/\s*\[\d+\]/g, '').trim()} ` : ''}[${page}]`.trim();
      return next === face.caption ? face : { ...face, caption: next };
    }
    case 'tile': {
      const valueNums = significant(node.value ?? '');
      let value = node.value;
      let source = node.source;
      if (valueNums.length) {
        const full = node.source && covers(byNumber(sources, node.source), valueNums)
          ? node.source
          : sources.find((item) => covers(item, valueNums))?.n
            ?? (query ? sources.find((item) => valueNums.every((num) => statedForAsk(item, num, query)))?.n : undefined);
        if (full) source = full;
        else if (value && keepsDerived(query, value, sources)) {
          // The figure is the age, quotient, year, or score the sources imply.
        } else if (value) {
          value = stripNums(value, valueNums);
          if (!value || !/\d/.test(value)) value = undefined;
          source = undefined;
        }
      }
      let sub = node.sub ? withoutForeignAgency(retargetCites(node.sub, sources), byNumber(sources, source ?? 0)) : node.sub;
      const label = withoutForeignAgency(node.label, byNumber(sources, source ?? 0));
      if (source && sub) {
        const missing = significant(sub).filter((num) => !has(byNumber(sources, source), num));
        if (missing.length) sub = stripNums(sub.replace(/\s*\[\d+\]/g, ''), missing);
      } else if (sub && !source && valueNums.length) {
        sub = stripNums(sub.replace(/\s*\[\d+\]/g, ''), significant(sub));
      }
      return value === node.value && sub === node.sub && source === node.source && label === node.label ? node : { ...node, value, sub, source, label };
    }
    case 'stat': {
      const nums = significant(node.value);
      const page = nums.length ? sources.find((item) => covers(item, nums)) : undefined;
      const value = nums.length && !page && !keepsDerived(query, node.value, sources) ? stripNums(node.value, nums) : node.value;
      const label = page ? withoutForeignAgency(node.label, page) : withoutForeignAgency(node.label, undefined);
      const delta = node.delta ? retargetCites(node.delta, sources) : node.delta;
      return value === node.value && delta === node.delta && label === node.label ? node : { ...node, value, label, delta };
    }
    case 'chart': {
      const data = node.data.filter((point) => {
        const nums = significant(String(point.value));
        return !nums.length || sources.some((item) => covers(item, nums));
      });
      return data.length === node.data.length ? node : { ...node, data };
    }
    case 'table': {
      const rows = node.rows.map((row) => row.map((cell) => {
        const nums = significant(cell);
        if (!nums.length) return cell;
        return sources.some((item) => covers(item, nums)) ? cell : stripNums(cell, nums);
      }));
      const same = rows.every((row, i) => row.every((cell, j) => cell === node.rows[i]![j]));
      return same ? node : { ...node, rows };
    }
    case 'list': {
      const items = node.items.map((item) => {
        const text = retargetCites(item.text, sources, query);
        // Meta is a plain label next to the source chip, so a number moves the chip
        // instead of writing [n] into the price or the year.
        const metaNums = item.meta ? significant(item.meta) : [];
        let meta = item.meta;
        let source = citeValue(text, sources, item.source);
        if (meta && metaNums.length) {
          const page = source && covers(byNumber(sources, source), metaNums)
            ? source
            : sources.find((entry) => covers(entry, metaNums))?.n ?? bestPage(metaNums, sources, source ? [source] : []);
          if (page) {
            const missing = metaNums.filter((num) => !has(byNumber(sources, page), num));
            if (missing.length) meta = stripNums(meta.replace(/\s*\[\d+\]/g, ''), missing);
            source = page;
          } else {
            meta = stripNums(meta, metaNums);
          }
          meta = meta.replace(/\s*\[\d+\]/g, '').trim();
        }
        return text === item.text && meta === item.meta && source === item.source ? item : { ...item, text, meta, source };
      });
      const kept = peerPaperItems(query, items, sources);
      if (!kept.length && items.length) return { type: 'stack', direction: 'col', gap: 'sm', children: [] };
      return kept.length === node.items.length && kept.every((item, index) => item === node.items[index]) ? node : { ...node, items: kept };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = retargetCites(item.value, sources, query);
        return value === item.value ? item : { ...item, value };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'timeline': {
      const items = node.items.map((item) => {
        const source = citeValue(`${item.when} ${item.title} ${item.text ?? ''}`, sources, item.source);
        const text = item.text ? retargetCites(item.text, sources) : item.text;
        return source === item.source && text === item.text ? item : { ...item, source, text };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'links': {
      const items = node.items.filter((item) => peerPaperSource(query, byNumber(sources, item.source)));
      if (items.length === node.items.length) return node;
      if (!items.length) return { type: 'stack', direction: 'col', gap: 'sm', children: [] };
      return { ...node, items };
    }
    case 'profile':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'citations':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

interface TaxPick { rate: number; n: number }

function placePhrase(query: string): string[] {
  const city = query.match(/\b(?:in|for|at)\s+((?:[A-Z][A-Za-z.]*|NYC|USA)(?:\s+(?:[A-Z][A-Za-z.]*|of|the)){0,4})/);
  if (!city) return [];
  return city[1]!.toLowerCase().split(/\s+/).filter((word) => word !== 'of' && word !== 'the');
}

/** A government host. A blog that rounds a rate is not this. */
function officialDomain(domain: string | undefined): boolean {
  const host = (domain ?? '').toLowerCase().replace(/^www\./, '').split('/')[0]?.split(':')[0] ?? '';
  if (!host) return false;
  return /\.gov(?:\.[a-z]{2})?$/.test(host) || /\.mil(?:\.[a-z]{2})?$/.test(host) || /\.state\.[a-z]{2}\.us$/.test(host);
}

/** 8 stands in for 8.875 when the official page states the fuller rate. */
function roundedStandIn(round: number, precise: number): boolean {
  if (Number.isInteger(precise) || !Number.isInteger(round)) return false;
  return round === Math.trunc(precise) || round === Math.round(precise);
}

const NOT_A_PLACE = new Set([
  'while', 'where', 'which', 'after', 'before', 'under', 'there', 'these', 'those', 'their',
  'other', 'also', 'many', 'most', 'some', 'such', 'only', 'even', 'from', 'into', 'over',
  'with', 'this', 'that', 'each', 'both', 'more', 'than', 'then', 'when', 'what', 'have',
  'been', 'were', 'will', 'would', 'could', 'should', 'during', 'within', 'without',
  'between', 'through', 'including', 'excluding', 'effective', 'source', 'table', 'below',
  'above', 'therefore', 'however', 'although', 'because', 'since', 'until', 'among',
  'across', 'around', 'based', 'using', 'being', 'about', 'first', 'years', 'listed',
  'various', 'following', 'current', 'history', 'reform', 'public', 'county', 'percent',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'upon', 'remained', 'remains', 'constant', 'uniform',
  'established', 'imposed', 'authorized', 'twenty', 'build', 'fund', 'proceeds',
]);

/** Percents that are the rate, not a share of the proceeds ("of which the state retains 80%"). */
function percentRates(sentence: string): number[] {
  // A fetched page often escapes the decimal ("8\.25 percent"). That is 8.25, not 25.
  const cut = (sentence.split(/\bof which\b/i)[0] ?? sentence).replace(/\\(?=\.)/g, '');
  const rates: number[] = [];
  for (const match of cut.matchAll(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/gi)) {
    const at = match.index ?? 0;
    const after = cut.slice(at + match[0].length);
    if (/^\s+of\b/i.test(after)) continue;
    const before = cut.slice(Math.max(0, at - 32), at);
    if (/\b(?:retains|reserved|distributed|portion|share)\s*$/i.test(before)) continue;
    rates.push(Number(match[1]));
  }
  return rates;
}

/** A fund split ("1.75% to the Build Fund") is not the sales tax rate. */
function allocationShare(sentence: string): boolean {
  return /\b(?:fund|reserved|distributed|distribution|portion|proceeds)\b/i.test(sentence) && !/\brate\b/i.test(sentence);
}

/** "30% of total general revenues" is how big the tax is in the budget, not the rate on a purchase. */
function revenueShare(sentence: string): boolean {
  return /\b(?:percentage of|fiscal year|per year)\b/i.test(sentence) && !/\b(?:tax rate|merchandise)\b/i.test(sentence);
}

function sentenceHasAskWord(sentence: string, word: string): boolean {
  if (!sentence.includes(word)) return false;
  if (word === 'general' && /\bgeneral\s+revenues?\b/i.test(sentence) && !/\bgeneral\s+merchandise\b/i.test(sentence)) return false;
  return true;
}

/** "In 0.25% increments" is a step local taxes may use, not the rate being asked. */
function rateIncrement(sentence: string): boolean {
  return /\b(?:increments?|in addition|above and beyond|add-on|add on)\b/i.test(sentence);
}

function sourceStatesFullRate(source: ClaimSource): boolean {
  const body = `${source.text}\n${source.stated ?? ''}`;
  for (const sentence of body.split(SENTENCE_BREAK)) {
    if (allocationShare(sentence) || rateIncrement(sentence)) continue;
    if (percentRates(sentence).some((rate) => rate >= 1 && rate <= 30)) return true;
  }
  return false;
}

interface RateCand {
  rate: number;
  n: number;
  score: number;
  precise: boolean;
  official: boolean;
  combined: boolean;
  place: boolean;
}

/**
 * The rate that applies to the purchase the question names. A city question uses the combined
 * local rate a source states, and a threshold on that page ("under $110") decides which rate.
 * A rate on an official page beats a round figure from somewhere else. A combined rate beats
 * the state-only piece when the page states both.
 */
export function salesTax(query: string, sources: readonly ClaimSource[]): TaxPick | undefined {
  if (!TAX_ASK.test(query) || !sources.length) return undefined;
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = price ? Number(price[1]!.replace(/,/g, '')) : undefined;
  const place = placePhrase(query);
  const found: RateCand[] = [];
  const fullerOfficial = sources.some((source) => officialDomain(source.domain) && sourceStatesFullRate(source));
  for (const source of sources) {
    const official = officialDomain(source.domain);
    const body = `${source.text}\n${source.stated ?? ''}`;
    const head = (body.split('\n')[0] ?? '').toLowerCase();
    const sentences = body.split(SENTENCE_BREAK);
    for (const sentence of sentences) {
      if (allocationShare(sentence) || revenueShare(sentence)) continue;
      const percents = percentRates(sentence);
      if (!percents.length) continue;
      const low = sentence.toLowerCase();
      const blob = `${head} ${low}`;
      const namesPlace = place.length > 0 && (place.every((word) => blob.includes(word)) || (place.includes('nyc') && blob.includes('new york')));
      const aboutPlace = place.length === 0 || namesPlace;
      const aboutRevenue = /\b(?:total\s+(?:general\s+)?revenue|percentage of)\b/i.test(sentence);
      // "The total includes the state's rate of 6.25%" states the state piece, not the combined rate.
      const statePiece = /\bstate(?:'s)?\b/i.test(sentence) && /\b(?:includes?|included|portion|of which|component)\b/i.test(sentence);
      const combined = !aboutRevenue && !statePiece && (/\b(?:combined|overall)\b/i.test(sentence) || (/\btotal\b/i.test(sentence) && !/\bstate(?:'s)?\s+(?:sales|use|tax)/i.test(sentence)));
      const stateOnly = statePiece || (/\bstate\b/i.test(sentence) && !combined);
      if (/\b(?:mixed beverage|gross receipts|property tax|income tax|franchise tax)\b/i.test(sentence) && !/\b(?:beverage|gross receipts|property tax|income tax|franchise)\b/i.test(query)) continue;
      const threshold = sentence.match(/(?:under|below|less than)\s+\$\s?(\d{1,3}(?:,\d{3})*)/i);
      const cut = threshold ? Number(threshold[1]!.replace(/,/g, '')) : undefined;
      const aboveCut = cut !== undefined && amount !== undefined && amount >= cut;
      const belowCut = cut !== undefined && amount !== undefined && amount < cut;
      const forAbove = /\b(and (?:up|above|over)|or more|full combined|full rate)\b/i.test(sentence);
      const forBelow = /\b(under|below|less than|exempt)\b/i.test(sentence);
      const rates = combined && percents.length > 1 ? [Math.max(...percents)] : percents;
      for (const rate of rates) {
        let score = 0;
        if (namesPlace) score += 4;
        // A commercial combined rate does not outrank a figure the official page states.
        const officialBeatsCommercial = sources.some((item) => officialDomain(item.domain));
        if (combined && aboutPlace) score += official || !officialBeatsCommercial ? 12 : 2;
        else if (combined) score += 1;
        if (official && aboutPlace) score += officialBeatsCommercial ? 20 : 6;
        else if (official) score += 2;
        if (!aboutPlace) score -= 8;
        if (stateOnly) score -= 3;
        // A question that asks for the combined rate does not lead with the state piece when a source states the combined rate.
        if (/\bcombined\b/i.test(query) && stateOnly) score -= 16;
        if (/\bcombined\b/i.test(query) && combined && aboutPlace) score += 6;
        for (const word of questionWords(query)) if (sentenceHasAskWord(low, word)) score += 4;
        if (otherPlace(sentence, query)) score -= 20;
        if (percents.length > 1 && !combined) score -= 6;
        if (rate < 1 && percents.some((item) => item >= 1)) score -= 12;
        if (rateIncrement(sentence)) score -= 18;
        // A tenth of a percent does not lead when an official page states a full rate.
        if (rate < 1 && fullerOfficial) score -= 16;
        if (/\b(?:current|remained|remains)\b/i.test(sentence)) score += 8;
        if (aboveCut && forBelow && !forAbove && !combined) score -= 5;
        if (belowCut && combined && forBelow) score -= 4;
        if (aboveCut && (combined || forAbove)) score += 3;
        found.push({ rate, n: source.n, score, precise: !Number.isInteger(rate), official, combined, place: namesPlace });
      }
    }
  }
  if (amount !== undefined && exemptPrice(amount, sources)) return undefined;
  let best = found.reduce<RateCand | undefined>((pick, cand) => {
    if (!pick || cand.score > pick.score) return cand;
    if (cand.score === pick.score && cand.precise && !pick.precise) return cand;
    if (cand.score === pick.score && cand.official && !pick.official && cand.precise === pick.precise) return cand;
    return pick;
  }, undefined);
  if (best && Number.isInteger(best.rate)) {
    const sharper = found.find((cand) => (cand.official || cand.combined) && cand.place && roundedStandIn(best!.rate, cand.rate));
    if (sharper) best = sharper;
  }
  if (!best || best.score < 1) return undefined;
  return { rate: best.rate, n: best.n };
}

const QUESTION_SKIP = new Set(['sales', 'tax', 'taxes', 'rate', 'rates', 'what', 'which', 'where', 'when', 'does', 'apply', 'applies', 'purchase', 'official', 'current', 'state', 'local']);

function questionWords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5 && !QUESTION_SKIP.has(word));
}

/** A city or county the question did not name. Its rate is not the answer for the broader place. */
function otherPlace(sentence: string, query: string): boolean {
  const asked = query.toLowerCase();
  const names = sentence.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  return names.some((name) => {
    const word = name.toLowerCase();
    if (asked.includes(word)) return false;
    if (QUESTION_SKIP.has(word) || NOT_A_PLACE.has(word)) return false;
    // "Austin, Texas" names the state after the city. It is not some other city's rate.
    const askedWords = asked.split(/[^a-z0-9]+/).filter((part) => part.length > 3).join('|');
    if (askedWords && new RegExp(`\\b(?:${askedWords}),\\s+${name}\\b`, 'i').test(sentence)) return false;
    return word.length >= 5;
  });
}

function questionPrice(query: string): number | undefined {
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  return price ? Number(price[1]!.replace(/,/g, '')) : undefined;
}

/** A source says this price is under an exemption line ("under $110 … exempt"). */
function exemptPrice(amount: number, sources: readonly ClaimSource[]): boolean {
  for (const source of sources) {
    for (const sentence of source.text.split(SENTENCE_BREAK)) {
      if (!/\bexempt\b/i.test(sentence)) continue;
      const threshold = sentence.match(/(?:under|below|less than)\s+\$\s?(\d{1,3}(?:,\d{3})*)/i);
      if (!threshold) continue;
      if (amount < Number(threshold[1]!.replace(/,/g, ''))) return true;
    }
  }
  return false;
}

function combinedRate(sources: readonly ClaimSource[], query = ''): { rate: number; n: number } | undefined {
  const place = placePhrase(query);
  let best: { rate: number; n: number; score: number } | undefined;
  for (const source of sources) {
    const body = `${source.text}\n${source.stated ?? ''}`;
    const head = (body.split('\n')[0] ?? '').toLowerCase();
    const official = officialDomain(source.domain);
    for (const sentence of body.split(SENTENCE_BREAK)) {
      if (!/\bcombined\b/i.test(sentence)) continue;
      const percents = [...sentence.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
      const rate = percents.sort((a, b) => b - a)[0];
      if (rate === undefined) continue;
      const blob = `${head} ${sentence.toLowerCase()}`;
      const namesPlace = place.length > 0 && place.every((word) => blob.includes(word));
      let score = 0;
      if (place.length === 0 || namesPlace) score += 10;
      if (official) score += 5;
      if (!best || score > best.score || (score === best.score && rate > best.rate)) best = { rate, n: source.n, score };
    }
  }
  return best ? { rate: best.rate, n: best.n } : undefined;
}

/**
 * A dollar amount in parentheses has to be the percent in that same sentence times the
 * price that sentence is about. A rate from another line, or the tax on a different price, goes.
 * A line that says "combined" uses the combined rate the sources state.
 */
export function fixTaxLines(text: string, query: string, sources: readonly ClaimSource[]): string {
  const price = questionPrice(query);
  const combined = salesTax(query, sources) ?? combinedRate(sources, query);
  const parts = text.split(SENTENCE_BREAK);
  return parts.map((sentence) => {
    let next = sentence;
    const above = /(?:or more|and (?:up|above|over))/i.test(next);
    const cut = next.match(/\$\s?(\d{1,3}(?:,\d{3})*)/);
    const cutAmount = cut ? Number(cut[1]!.replace(/,/g, '')) : undefined;
    const aboutHigher = above && price !== undefined && cutAmount !== undefined && price < cutAmount;
    if (combined && (/\bcombined\b/i.test(next) || aboutHigher)) {
      next = next.replace(/(\d{1,2}(?:\.\d+)?)\s*%/, `${combined.rate}%`);
    }
    const pct = next.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    const due = next.match(/\(\s*\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*\)/);
    if (!pct || !due) return next;
    const rate = Number(pct[1]);
    const dollars = moneyValue(due[0]);
    const base = aboutHigher ? cutAmount : price;
    if (base === undefined) return next;
    const expected = Math.round(base * rate) / 100;
    if (Math.abs(dollars - expected) <= 0.05) return next;
    return next.replace(/\(\s*\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*\)/, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  }).join(' ');
}

const NOT_TAX_RATE = /\b(?:fee|fees|interest|apr|apy|discount|tip|tips|gratuity|commission|cash ?back|rebate|off)\b/i;

function applyTaxText(text: string, query: string, pick: TaxPick, _keep: ReadonlySet<number>): string {
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = price ? Number(price[1]!.replace(/,/g, '')) : undefined;
  const shown = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/gi)].map((match) => Number(match[1]));
  const wrong = shown.find((rate) => Math.abs(rate - pick.rate) > 0.001);
  if (wrong === undefined) return text;
  // "The 8.875% combines the 4% state, 4.5% city and 0.375% MCTD rates": a sentence that already states the combined
  // rate, or lists several rates, gives its parts or a range. Rewriting each to 8.875% made "4.5%" read "8.875%".
  const RATE = /(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/gi;
  let out = text.split(/(?<=[.!?])\s+/).map((sentence) => {
    // "Nintendo adds a fee of 1.5% of the sale price": a fee, interest or discount rate is not the sales tax.
    if (NOT_TAX_RATE.test(sentence) && !/\btax\b/i.test(sentence.replace(NOT_TAX_RATE, ''))) return sentence;
    const rates = [...sentence.matchAll(RATE)].map((match) => Number(match[1]));
    if (rates.some((rate) => Math.abs(rate - pick.rate) <= 0.001) || new Set(rates).size >= 2) return sentence;
    return sentence.replace(RATE, (raw, num) => {
      if (Math.abs(Number(num) - pick.rate) <= 0.001) return raw;
      return raw.includes('%') ? `${pick.rate}%` : `${pick.rate} percent`;
    });
  }).join(' ');
  out = out.replace(/\[(\d+)\]/g, `[${pick.n}]`);
  if (amount === undefined) return out;
  const due = amount * pick.rate / 100;
  const formatted = `$${due.toFixed(2)}`;
  const wrongDue = amount * wrong / 100;
  let replaced = false;
  out = out.replace(MONEY, (raw) => {
    const value = moneyValue(raw);
    if (Math.abs(value - amount) < 0.001) return raw;
    if (Math.abs(value - wrongDue) < 0.05) {
      replaced = true;
      return formatted;
    }
    return raw;
  });
  if (!replaced) out = out.replace(`${pick.rate}%`, `${pick.rate}% (${formatted})`);
  return out.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ');
}

function ratesIn(source: ClaimSource | undefined): Set<number> {
  const found = new Set<number>();
  if (!source) return found;
  for (const match of `${source.text}\n${source.stated ?? ''}`.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)) found.add(Number(match[1]));
  return found;
}

function applyTax(node: CardNode, query: string, pick: TaxPick, keep: ReadonlySet<number>): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'scroller':
      return { ...node, children: node.children.map((child) => applyTax(child, query, pick, keep)) };
    case 'section': {
      const title = node.title ? applyTaxText(node.title, query, pick, keep) : node.title;
      const children = node.children.map((child) => applyTax(child, query, pick, keep));
      return title === node.title && children.every((child, index) => child === node.children[index]) ? node : { ...node, title, children };
    }
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => applyTax(child, query, pick, keep)) })) };
    case 'text':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = applyTaxText(node.text, query, pick, keep);
      return text === node.text ? node : { ...node, text };
    }
    case 'callout': {
      const text = applyTaxText(node.text, query, pick, keep);
      const title = node.title ? applyTaxText(node.title, query, pick, keep) : node.title;
      return text === node.text && title === node.title ? node : { ...node, text, title };
    }
    case 'hero': {
      const caption = node.caption ? applyTaxText(node.caption, query, pick, keep) : node.caption;
      const label = node.label ? applyTaxText(node.label, query, pick, keep) : node.label;
      const value = componentRate(node) ? node.value : node.unit === '%' || node.unit === 'percent' ? String(pick.rate) : applyTaxText(node.value, query, pick, keep);
      return caption === node.caption && label === node.label && value === node.value ? node : { ...node, caption, label, value };
    }
    case 'tile': {
      const value = node.value && !componentRate(node) ? applyTaxText(node.value, query, pick, keep) : node.value;
      // A fee's or a part's own detail ("1.5% of retail" under "Nintendo fee cap") is that charge's rate, not the tax.
      const sub = node.sub && !componentRate(node) ? applyTaxText(node.sub, query, pick, keep) : node.sub;
      const label = applyTaxText(node.label, query, pick, keep);
      return value === node.value && sub === node.sub && label === node.label ? node : { ...node, value, sub, label, source: node.source ?? pick.n };
    }
    case 'stat': {
      if (componentRate(node)) return node;
      const label = applyTaxText(node.label, query, pick, keep);
      const value = node.unit === '%' || node.unit === 'percent' ? String(pick.rate) : applyTaxText(node.value, query, pick, keep);
      return label === node.label && value === node.value ? node : { ...node, label, value };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = componentRate(item) ? item.value : applyTaxText(item.value, query, pick, keep);
        return value === item.value ? item : { ...item, value };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'list': {
      const items = node.items.map((item) => {
        const text = applyTaxText(item.text, query, pick, keep);
        const meta = item.meta ? applyTaxText(item.meta, query, pick, keep) : item.meta;
        return text === item.text && meta === item.meta ? item : { ...item, text, meta };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'table': {
      const rows = node.rows.map((row) => row.map((cell) => applyTaxText(cell, query, pick, keep)));
      return rows.every((row, index) => row.every((cell, cellIndex) => cell === node.rows[index]?.[cellIndex])) ? node : { ...node, rows };
    }
    case 'timeline': {
      const items = node.items.map((item) => {
        const title = applyTaxText(item.title, query, pick, keep);
        const text = item.text ? applyTaxText(item.text, query, pick, keep) : item.text;
        return title === item.title && text === item.text ? item : { ...item, title, text };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'accordion':
      return { ...node, items: node.items.map((item) => ({ ...item, title: applyTaxText(item.title, query, pick, keep), text: applyTaxText(item.text, query, pick, keep) })) };
    case 'proscons':
      return { ...node, pros: node.pros.map((item) => applyTaxText(item, query, pick, keep)), cons: node.cons.map((item) => applyTaxText(item, query, pick, keep)) };
    case 'badges':
      return { ...node, items: node.items.map((item) => applyTaxText(item, query, pick, keep)) };
    case 'steps':
      return { ...node, items: node.items.map((item) => ({ ...item, title: applyTaxText(item.title, query, pick, keep), detail: item.detail ? applyTaxText(item.detail, query, pick, keep) : item.detail })) };
    case 'profile':
      return { ...node, subtitle: node.subtitle ? applyTaxText(node.subtitle, query, pick, keep) : node.subtitle, facts: node.facts?.map((fact) => ({ ...fact, value: applyTaxText(fact.value, query, pick, keep) })) };
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** An unpriced pick drops once any pick has a price. Priced picks keep their order. */
function rankPriced<T>(items: readonly T[], ceilings: readonly number[], pricedText: (item: T) => string): T[] {
  const scored = items.map((item, index) => ({ item, index, priced: hasPrice(pricedText(item), ceilings) }));
  if (!scored.some((row) => row.priced)) return items.map((item) => item);
  return scored.filter((row) => row.priced).sort((a, b) => a.index - b.index).map((row) => row.item);
}

/** A dollar amount above the ask's ceiling is not a price for that pick. "under $200" leaves with the amount. */
function stripOverBudget(text: string, ceilings: readonly number[]): string {
  const cap = Math.min(...ceilings);
  const money = MONEY.source;
  return text
    .replace(new RegExp(`\\b(?:under|below|less than|cheaper than|up to|at most)\\s+${money}`, 'gi'), (raw) => {
      const amount = raw.match(new RegExp(money, 'i'))?.[0];
      return amount && moneyValue(amount) > cap ? '' : raw;
    })
    .replace(new RegExp(money, 'g'), (raw) => (moneyValue(raw) > cap ? '' : raw))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,·-]+|[\s,·-]+$/g, '')
    .trim();
}

/** A chip above the ceiling is cleared. A label that was only that price is dropped. */
function insideCeiling(text: string | undefined, ceilings: readonly number[]): string | undefined {
  if (!text || !ceilings.length) return text;
  const next = stripOverBudget(text, ceilings);
  if (!next || (next !== text.trim() && !/\d/.test(next))) return undefined;
  return next;
}

/** A budget control above the ask's ceiling ("Under $200" on an under-$150 ask) is not offered. */
function overBudget(text: string, ceilings: readonly number[]): boolean {
  const cap = Math.min(...ceilings);
  return [...text.matchAll(new RegExp(MONEY.source, 'g'))].some((match) => moneyValue(match[0]) > cap);
}

/** Prices on a pick stay inside the budget the question stated. A higher chip is cleared. */
function keepBudgetPrices(node: CardNode, ceilings: readonly number[]): CardNode {
  if (!ceilings.length) return node;
  switch (node.type) {
    case 'list': {
      const items = node.items.map((item) => {
        const meta = insideCeiling(item.meta, ceilings);
        const text = stripOverBudget(item.text, ceilings);
        return meta === item.meta && text === item.text ? item : { ...item, meta, text };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'tile': {
      const value = insideCeiling(node.value, ceilings);
      const sub = insideCeiling(node.sub, ceilings);
      return value === node.value && sub === node.sub ? node : { ...node, value, sub };
    }
    case 'stat': {
      const value = insideCeiling(node.value, ceilings) ?? '';
      return value === node.value ? node : { ...node, value };
    }
    case 'hero': {
      const value = insideCeiling(node.value, ceilings) ?? node.value;
      const label = node.label === undefined ? undefined : stripOverBudget(node.label, ceilings);
      const caption = node.caption === undefined ? undefined : stripOverBudget(node.caption, ceilings);
      return value === node.value && label === node.label && caption === node.caption ? node : { ...node, value, label, caption };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => keepBudgetPrices(child, ceilings)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => keepBudgetPrices(child, ceilings)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = 'text' in node && typeof node.text === 'string' ? stripOverBudget(node.text, ceilings) : undefined;
      return text === undefined || text === node.text ? node : { ...node, text };
    }
    case 'choices': {
      const options = node.options.filter((option) => !overBudget(option.label, ceilings));
      return options.length === node.options.length ? node : { ...node, options };
    }
    case 'keyvalue':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** A priced list drops a pick that still has no price. A list with no prices at all stays, so a miss does not empty the card. */
function dropPriceless(node: CardNode, ceilings: readonly number[], query: string): CardNode {
  switch (node.type) {
    case 'list': {
      const items = rankPriced(node.items, ceilings, (item) => `${item.meta ?? ''} ${item.text}`);
      return items.length === node.items.length && items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => dropPriceless(child, ceilings, query));
      const tiles = children.filter((child): child is Extract<CardNode, { type: 'tile' }> => child.type === 'tile');
      if (tiles.length < 2) {
        return children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
      }
      const ranked = rankPriced(tiles, ceilings, (tile) => `${tile.value ?? ''} ${tile.sub ?? ''} ${tile.label}`);
      let placed = false;
      const next: CardNode[] = [];
      for (const child of children) {
        if (child.type !== 'tile') {
          next.push(child);
          continue;
        }
        if (placed) continue;
        placed = true;
        next.push(...ranked);
      }
      return next.length === node.children.length && next.every((child, index) => child === node.children[index]) ? node : { ...node, children: next };
    }
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => dropPriceless(child, ceilings, query)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'hero':
    case 'stat':
    case 'tile':
    case 'keyvalue':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

const MEMBER = /\bwhich\b[\s\S]{0,160}\b(?:have|has|had|did|does|appeared|appear)\b/i;
const WORK_STOP = new Set([
  'there', 'their', 'about', 'which', 'would', 'could', 'other', 'every', 'first', 'after',
  'before', 'video', 'music', 'videos', 'appeared', 'appear', 'appears', 'starred', 'friends',
  'series', 'member', 'members', 'main', 'cast', 'wanna', 'gonna', 'something', 'someone',
  'where', 'these', 'those', 'being', 'been', 'have', 'with', 'from', 'that', 'this', 'into',
  'over', 'your', 'them', 'they', 'were', 'when', 'what',
]);

const NAME_SKIP = new Set(['main', 'cast', 'music', 'video', 'theme', 'official', 'series', 'north', 'south', 'east', 'west', 'great', 'new', 'york', 'united', 'states']);
const PERSON_NAME = /\b[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})+\b/g;

function properName(text: string): string | undefined {
  return peopleIn(text)[0];
}

function peopleIn(text: string): string[] {
  return [...text.matchAll(PERSON_NAME)].map((match) => match[0]).filter((name) => (
    name.split(/\s+/).every((part) => !NAME_SKIP.has(part.toLowerCase()))
  ));
}

function lastOf(person: string): string {
  return person.split(/\s+/).at(-1)?.replace(/[^A-Za-z'’-]/g, '') ?? '';
}

function samePerson(a: string, b: string): boolean {
  const left = lastOf(a).toLowerCase();
  const right = lastOf(b).toLowerCase();
  return left.length >= 3 && left === right;
}

function workWords(text: string): string[] {
  const words = text.replace(/[’']/g, '').split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase());
  return [...new Set(words.filter((word) => word.length >= 5 && !WORK_STOP.has(word)))];
}

function appearanceClues(parts: string[], person: string): string[] {
  const own = new Set(person.toLowerCase().split(/\s+/));
  return parts.flatMap((part) => workWords(part)).filter((word) => !own.has(word));
}

function escapeName(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function actPhrase(query: string): string | undefined {
  const match = query.match(/\b(?:appeared|appear|starred|featured)\s+in\s+(?:an?\s+|the\s+)?([a-z][a-z\s]{2,40}?)(?:\?|$)/i);
  const phrase = match?.[1]?.trim().toLowerCase().replace(/s$/, '');
  return phrase && phrase.length >= 5 ? phrase : undefined;
}

function sentenceAt(text: string, at: number): string {
  let start = 0;
  for (const mark of ['.', '\n', '!', '?']) {
    const found = text.lastIndexOf(mark, Math.max(0, at - 1));
    if (found >= start) start = found + 1;
  }
  let end = text.length;
  for (const mark of ['.', '\n', '!', '?']) {
    const found = text.indexOf(mark, at);
    if (found !== -1 && found < end) end = found;
  }
  return text.slice(start, end);
}

function workOf(query: string): string | undefined {
  return query.match(/\b(?:series|show|film|movie|play|band|team)\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)*)/)?.[1];
}

function previousSentence(text: string, at: number): string {
  const before = text.slice(0, Math.max(0, at));
  const end = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'));
  if (end <= 0) return '';
  return sentenceAt(before, Math.max(0, end - 1));
}

function topicalText(text: string, act: string | undefined, clues: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return (act ? lower.includes(act) : false) || clues.some((clue) => clue.length >= 5 && lower.includes(clue));
}

/** The verb in this sentence is about this person, and the sentence is not a group or theme credit. */
function attributesAct(sentence: string, person: string, act: string | undefined, clues: readonly string[], prior = ''): boolean {
  const last = lastOf(person);
  if (last.length < 3) return false;
  const own = topicalText(sentence, act, clues);
  const carried = !own && topicalText(prior, act, clues);
  if (!own && !carried) return false;
  if (/\btheme\s+(?:song|video)\b/i.test(sentence)) return false;
  if (/\b(?:the\s+)?(?:main\s+|entire\s+|whole\s+)?cast\b/i.test(sentence) && !new RegExp(`\\b${escapeName(last)}\\s+(?:appeared|appears|starred|featured|was|is)\\b`, 'i').test(sentence)) return false;
  if (carried && peopleIn(sentence).length >= 3) return false;
  const verb = 'appeared|appears|appear|starred|stars|featured|features|starring|seen|been';
  for (const match of sentence.matchAll(new RegExp(`\\b(?:${verb})\\b`, 'gi'))) {
    const before = sentence.slice(Math.max(0, (match.index ?? 0) - 140), match.index ?? 0);
    const nearest = peopleIn(before).at(-1);
    if (nearest && samePerson(nearest, person)) return true;
  }
  return false;
}

/**
 * A sentence credits this person on their own.
 * A page that merely names them beside the whole group, or beside the act's owner, does not.
 */
function individualCredit(
  sources: readonly { text: string; title?: string; url?: string }[],
  person: string,
  group: readonly string[],
  clues: readonly string[],
  act?: string,
): boolean {
  const needles = [...clues, ...(act ? [act] : [])];
  if (!needles.length) return true;
  const last = lastOf(person);
  if (last.length < 3) return true;
  const others = group
    .filter((name) => !samePerson(name, person))
    .map((name) => lastOf(name))
    .filter((name) => name.length >= 3);
  return sources.some((source) => {
    const text = `${source.title ?? ''}. ${source.text}`;
    const re = new RegExp(`\\b${escapeName(last)}\\b`, 'gi');
    for (const match of text.matchAll(re)) {
      const at = match.index ?? 0;
      const sentence = sentenceAt(text, at);
      if (!attributesAct(sentence, person, act, clues, previousSentence(text, at))) continue;
      const extra = new Set(peopleIn(sentence).map((name) => lastOf(name).toLowerCase()).filter((name) => name && name !== last.toLowerCase()));
      for (const name of others) {
        if (new RegExp(`\\b${escapeName(name)}\\b`, 'i').test(sentence)) extra.add(name.toLowerCase());
      }
      if (extra.size >= 2) continue;
      return true;
    }
    return false;
  });
}

function rosterNames(sources: readonly { text: string; title?: string; url?: string }[], work: string | undefined): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    const text = `${source.title ?? ''}\n${source.text}`;
    if (work && !text.toLowerCase().includes(work.toLowerCase())) continue;
    for (const mark of text.matchAll(/\b(?:main cast|cast members|starring)\b/gi)) {
      const names: string[] = [];
      const chunks = text.slice(mark.index ?? 0, (mark.index ?? 0) + 900).split(/(?<=[.!?·|])\s+/);
      for (const chunk of chunks) {
        if (names.length && /\b(?:appeared|appears|starred|featured|seen|been|theme)\b/i.test(chunk)) break;
        const people = peopleIn(chunk);
        if (!people.length && names.length) break;
        people.forEach((name) => names.push(name));
      }
      const unique = [...new Set(names)];
      if (unique.length < 3) continue;
      unique.forEach((name) => found.add(name));
    }
  }
  return [...found];
}

/** People a source credits for the act on their own, not as a named group. */
function creditedPeople(
  query: string,
  sources: readonly { text: string; title?: string; url?: string }[],
  group: readonly string[],
): string[] {
  const act = actPhrase(query);
  if (!act) return [];
  const work = workOf(query);
  const roster = rosterNames(sources, work);
  const pool = [...new Set([...group, ...roster])];
  const found = new Map<string, string>();
  for (const source of sources) {
    const blob = `${source.title ?? ''} ${source.url ?? ''} ${source.text}`;
    const onWork = !work || blob.toLowerCase().includes(work.toLowerCase());
    for (const name of new Set(peopleIn(`${source.title ?? ''}. ${source.text}`))) {
      const known = pool.some((person) => samePerson(person, name));
      if (!onWork && !known) continue;
      if (!individualCredit([source], name, pool, [], act)) continue;
      const key = lastOf(name).toLowerCase();
      if (!found.has(key)) found.set(key, name);
    }
  }
  return [...found.values()];
}

function memberNames(nodes: readonly CardNode[]): string[] {
  const found: string[] = [];
  const walk = (node: CardNode): void => {
    if (node.type === 'tile') {
      const name = properName(node.label) ?? properName(`${node.value ?? ''} ${node.sub ?? ''}`);
      if (name) found.push(name);
    } else if (node.type === 'list') {
      for (const item of node.items) {
        const name = properName(item.text);
        if (name) found.push(name);
      }
    } else if (node.type === 'keyvalue') {
      for (const item of node.items) {
        const name = properName(item.label);
        if (name) found.push(name);
      }
    } else if (node.type === 'table') {
      for (const row of node.rows) {
        const name = row.reduce<string | undefined>((hit, cell) => hit ?? properName(cell), undefined);
        if (name) found.push(name);
      }
    } else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
      node.children.forEach(walk);
    } else if (node.type === 'tabs') {
      node.tabs.forEach((tab) => tab.children.forEach(walk));
    }
  };
  nodes.forEach(walk);
  return [...new Set(found)];
}

function affirmsAppearance(value?: string, extra?: string, active?: boolean): boolean {
  const blob = `${value ?? ''} ${extra ?? ''}`.trim();
  if (/\b(?:no|not|never|none)\b/i.test(blob) && !/\byes\b/i.test(blob)) return false;
  if (active || /\byes\b/i.test(blob)) return true;
  return workWords(blob).length > 0;
}

const ABSTAIN = /\b(?:can(?:not|'t|’t)|could(?:\s+not|n't|n’t))\s+be\s+answered\b|\b(?:do(?:es)?(?:\s+not|n't|n’t))\s+name\b/i;

function gridCols(count: number): 2 | 3 | 4 {
  if (count >= 4) return 4;
  if (count === 3) return 3;
  return 2;
}

function yesNames(nodes: readonly CardNode[]): string[] {
  const found: string[] = [];
  const walk = (node: CardNode): void => {
    if (node.type === 'tile') {
      const person = properName(node.label) ?? properName(node.value ?? '');
      if (person && affirmsAppearance(node.value, node.sub, node.active)) found.push(person);
    } else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
      node.children.forEach(walk);
    } else if (node.type === 'tabs') {
      node.tabs.forEach((tab) => tab.children.forEach(walk));
    }
  };
  nodes.forEach(walk);
  return found;
}

function placeCredits(nodes: CardNode[], missing: readonly string[], credited: boolean): CardNode[] {
  const tiles: CardNode[] = missing.map((label) => ({ type: 'tile', label, value: 'Yes', active: true }));
  let placed = tiles.length === 0;
  const cleaned = nodes.map((node) => {
    if ((node.type === 'grid' || node.type === 'section') && !placed && node.children.some((child) => child.type === 'tile' && properName(child.label))) {
      placed = true;
      return { ...node, children: [...node.children, ...tiles] };
    }
    if ((node.type === 'text' || node.type === 'callout' || node.type === 'quote') && credited) {
      const text = node.text.split(SENTENCE_BREAK).filter((sentence) => !ABSTAIN.test(sentence)).join(' ').trim();
      if (!placed && !text) {
        placed = true;
        return { type: 'grid' as const, cols: gridCols(tiles.length), children: tiles };
      }
      if (!placed && text !== node.text) {
        placed = true;
        return {
          type: 'stack' as const,
          direction: 'col' as const,
          gap: 'sm' as const,
          children: [{ type: 'grid' as const, cols: gridCols(tiles.length), children: tiles }, { ...node, text }],
        };
      }
      return text === node.text ? node : { ...node, text };
    }
    return node;
  });
  return placed ? cleaned : [...cleaned, { type: 'grid', cols: gridCols(tiles.length), children: tiles }];
}

function sharedKeys(rows: readonly string[][], pred: (cell: string) => boolean): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const cell of row) {
      const key = cell.trim().toLowerCase();
      if (!key || !pred(cell) || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count >= 3).map(([key]) => key));
}

/**
 * A "which of these people did this" yes stays only when a source credits that person
 * on their own. A group credit does not mark every named person yes, and a person the
 * sources do credit is still named when the card abstains.
 */
export function groundMembers(query: string, nodes: CardNode[], sources: readonly { text: string; title?: string; url?: string }[]): CardNode[] | undefined {
  if (!MEMBER.test(query) || sources.every((source) => source.text.trim().length < 20)) return undefined;
  const group = memberNames(nodes);
  const act = actPhrase(query);
  const roster = rosterNames(sources, workOf(query));
  const members = roster.length >= 3 ? roster : group;
  const inGroup = (person: string): boolean => !members.length || members.some((name) => samePerson(name, person));
  const credited = creditedPeople(query, sources, group).filter(inGroup);
  let changed = false;
  const unsupported = (person: string, clues: string[]): boolean => !individualCredit(sources, person, group, clues, act);
  const creditedPerson = (person: string): boolean => credited.some((name) => samePerson(name, person));
  const denySentence = (sentence: string): boolean => {
    if (!/\b(?:appeared|appear(?:s|ed)?|starred|featured)\b/i.test(sentence)) return false;
    const person = properName(sentence);
    if (!person) return false;
    return unsupported(person, appearanceClues([sentence], person));
  };
  const walk = (node: CardNode): CardNode => {
    switch (node.type) {
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        return { ...node, children: node.children.map(walk) };
      case 'tabs':
        return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map(walk) })) };
      case 'tile': {
        const person = properName(node.label) ?? properName(node.value ?? '') ?? properName(node.sub ?? '');
        if (!person) return node;
        if (affirmsAppearance(node.value, node.sub, node.active) && members.length >= 3 && !inGroup(person)) {
          changed = true;
          return { ...node, value: 'No', sub: undefined, active: false };
        }
        if (!affirmsAppearance(node.value, node.sub, node.active) && inGroup(person) && (creditedPerson(person) || individualCredit(sources, person, group, [], act))) {
          changed = true;
          const sub = node.sub && /\b(?:not named|no source|not in)\b/i.test(node.sub) ? undefined : node.sub;
          return { ...node, value: 'Yes', sub, active: true };
        }
        if (!affirmsAppearance(node.value, node.sub, node.active)) return node;
        const clues = appearanceClues([node.sub ?? '', node.value ?? ''], person);
        if (!unsupported(person, clues)) return node;
        changed = true;
        return { ...node, value: 'No', sub: undefined, active: false };
      }
      case 'keyvalue': {
        const items = node.items.map((item) => {
          const person = properName(item.label) ?? properName(item.value);
          if (!person || !affirmsAppearance(item.value)) return item;
          if (!unsupported(person, appearanceClues([item.value], person))) return item;
          changed = true;
          return { ...item, value: 'No' };
        });
        return { ...node, items };
      }
      case 'list': {
        const items = node.items.filter((item) => {
          const person = properName(item.text);
          if (!person || !affirmsAppearance(item.text, item.meta)) return true;
          if (!unsupported(person, appearanceClues([item.text, item.meta ?? ''], person))) return true;
          changed = true;
          return false;
        });
        return { ...node, items };
      }
      case 'table': {
        const shared = sharedKeys(node.rows, (cell) => cell.trim().length >= 8 && !/^\d{4}$/.test(cell.trim()) && !/^(?:yes|no)$/i.test(cell.trim()));
        const sharedYears = shared.size ? sharedKeys(node.rows, (cell) => /^\d{4}$/.test(cell.trim())) : new Set<string>();
        const rows = node.rows.map((row) => {
          const person = row.reduce<string | undefined>((found, cell) => found ?? properName(cell), undefined);
          if (!person) return row;
          const own = !unsupported(person, appearanceClues(row, person));
          if (shared.size) {
            const next = row.map((cell) => {
              const key = cell.trim().toLowerCase();
              if (shared.has(key)) return own ? 'Yes' : 'No';
              if (sharedYears.has(key)) return '';
              return cell;
            });
            if (next.some((cell, index) => cell !== row[index])) changed = true;
            return next;
          }
          const blob = row.join(' ');
          if (!affirmsAppearance(blob)) {
            // The same card often credits the person elsewhere ("Courteney Cox · Dancing in the Dark [3]") while the table says No.
            const yesNo = row.findIndex((cell) => /^\s*no\s*$/i.test(cell ?? ''));
            if (yesNo < 0 || !inGroup(person) || !(creditedPerson(person) || individualCredit(sources, person, group, [], act))) return row;
            changed = true;
            return row.map((cell, index) => (index === yesNo ? 'Yes' : /\b(?:no|not)\b.*\b(?:found|credit|named|source)\b/i.test(cell ?? '') ? '' : cell));
          }
          if (own) return row;
          changed = true;
          return row.map((cell) => {
            if (/\byes\b/i.test(cell)) return 'No';
            if (properName(cell) === person) return cell;
            return workWords(cell).length ? '' : cell;
          });
        });
        return { ...node, rows };
      }
      case 'hero': {
        const blob = `${node.value} ${node.caption ?? ''} ${node.label}`;
        const group = /\b(?:all|every|each|entire|whole)\b/i.test(blob) || /\b\d+\s*of\s*\d+\b/.test(blob);
        if (!group || members.length < 3) return node;
        const yes = credited.filter(inGroup);
        const value = yes.length ? String(yes.length) : 'None';
        const caption = yes.length ? yes.join(', ') : 'No source credits one of them on their own.';
        if (value === node.value && caption === node.caption) return node;
        changed = true;
        return { ...node, value, caption };
      }
      case 'text':
      case 'callout':
      case 'quote':
      case 'draft': {
        const groupClaim = (sentence: string) => /\b(?:all|every|each|entire|whole)\b/i.test(sentence) && /\b(?:appeared|appear|starred|featured|cast)\b/i.test(sentence);
        const yesCount = credited.filter(inGroup).length;
        const kept = node.text.split(SENTENCE_BREAK).filter((sentence) => {
          if (groupClaim(sentence) && yesCount < Math.max(members.length, 1)) {
            changed = true;
            return false;
          }
          if (!denySentence(sentence)) return true;
          changed = true;
          return false;
        });
        const text = kept.join(' ').trim();
        return text === node.text ? node : { ...node, text };
      }
      case 'heading':
      case 'stat':
      case 'timeline':
      case 'profile':
      case 'steps':
      case 'accordion':
      case 'proscons':
      case 'badges':
      case 'actions':
      case 'choices':
      case 'links':
      case 'citations':
      case 'chart':
      case 'pricing':
      case 'scaler':
      case 'slider':
      case 'reveal':
      case 'image':
      case 'gallery':
      case 'video':
      case 'code':
      case 'divider':
      case 'progress':
      case 'rating':
      case 'diagram':
      case 'ticker':
      case 'slot':
        return node;
      default: {
        const unreachable: never = node;
        return unreachable;
      }
    }
  };
  let next = nodes.map(walk);
  const missing = credited.filter((name) => !yesNames(next).some((have) => samePerson(have, name)));
  const abstains = next.some((node) => (node.type === 'text' || node.type === 'callout' || node.type === 'quote') && ABSTAIN.test(node.text));
  if (missing.length || (credited.length > 0 && abstains)) {
    next = placeCredits(next, missing, credited.length > 0);
    changed = true;
  }
  return changed ? next : undefined;
}

function repairTaxNode(node: CardNode, query: string, sources: readonly ClaimSource[]): CardNode {
  const line = (text: string) => fixTaxLines(text, query, sources);
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => repairTaxNode(child, query, sources)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => repairTaxNode(child, query, sources)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
      return { ...node, text: line(node.text) };
    case 'hero':
      return { ...node, value: line(node.value), caption: node.caption ? line(node.caption) : node.caption };
    case 'tile':
      return componentRate(node) ? node : { ...node, value: node.value ? line(node.value) : node.value, sub: node.sub ? line(node.sub) : node.sub };
    case 'stat':
      return componentRate(node) ? node : { ...node, value: line(node.value), label: line(node.label) };
    case 'keyvalue':
    case 'list':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

interface ChargePick { amount: string; value: number; n: number }

/**
 * The dollar amount an official page states for this fee. A different amount on another site,
 * or an optional add-on on the same page, is not the charge.
 */
export function officialCharge(query: string, sources: readonly ClaimSource[]): ChargePick | undefined {
  if (!FEE_ASK.test(query) || TAX_ASK.test(query)) return undefined;
  let best: ChargePick & { score: number; official: boolean } | undefined;
  for (const source of sources) {
    const official = officialDomain(source.domain);
    const lead = leadFigure('levy', query, `${source.text}\n${source.stated ?? ''}`);
    if (!lead) continue;
    // A tied score stays with the official page. A line that names the subject more clearly wins
    // when that page's snippet pairs the amount with a different item.
    const closer = !best
      || lead.score > best.score
      || (lead.score === best.score && official && !best.official);
    if (closer) best = { amount: lead.figure, value: lead.value, n: source.n, score: lead.score, official };
  }
  if (!best) return undefined;
  return { amount: best.amount, value: best.value, n: best.n };
}

function officialAmounts(source: ClaimSource | undefined): (value: number) => boolean {
  const values: number[] = [];
  if (source) {
    for (const match of `${source.text}\n${source.stated ?? ''}`.matchAll(new RegExp(MONEY.source, 'g'))) values.push(moneyValue(match[0]));
  }
  return (value) => values.some((have) => Math.abs(have - value) < 0.001);
}

function swapFee(text: string, pick: ChargePick, stated: (value: number) => boolean): string {
  let replaced = false;
  const out = text.replace(new RegExp(MONEY.source, 'g'), (raw) => {
    const value = moneyValue(raw);
    if (stated(value) || Math.abs(value - pick.value) < 0.001) return raw;
    replaced = true;
    return pick.amount;
  });
  if (!replaced) return text;
  return out.replace(/\[(\d+)\]/, `[${pick.n}]`);
}

function applyCharge(node: CardNode, pick: ChargePick, stated: (value: number) => boolean): CardNode {
  const line = (text: string) => swapFee(text, pick, stated);
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => applyCharge(child, pick, stated)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => applyCharge(child, pick, stated)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
      return { ...node, text: line(node.text) };
    case 'hero':
      return { ...node, value: line(node.value), caption: node.caption ? line(node.caption) : node.caption };
    case 'tile':
      return { ...node, value: node.value ? line(node.value) : node.value, sub: node.sub ? line(node.sub) : node.sub };
    case 'stat':
      return { ...node, value: line(node.value), label: line(node.label) };
    case 'keyvalue':
      return { ...node, items: node.items.map((item) => ({ ...item, value: line(item.value) })) };
    case 'list':
      return { ...node, items: node.items.map((item) => ({ ...item, text: line(item.text), meta: item.meta ? line(item.meta) : item.meta })) };
    case 'table':
      return { ...node, rows: node.rows.map((row) => row.map((cell) => line(cell))) };
    case 'timeline':
      return { ...node, items: node.items.map((item) => ({ ...item, title: line(item.title), text: item.text ? line(item.text) : item.text })) };
    case 'steps':
      return { ...node, items: node.items.map((item) => ({ ...item, title: line(item.title), detail: item.detail ? line(item.detail) : item.detail })) };
    case 'accordion':
      return { ...node, items: node.items.map((item) => ({ ...item, title: line(item.title), text: line(item.text) })) };
    case 'proscons':
      return { ...node, pros: node.pros.map(line), cons: node.cons.map(line) };
    case 'badges':
      return { ...node, items: node.items.map(line) };
    case 'profile':
      return { ...node, facts: node.facts?.map((fact) => ({ ...fact, value: line(fact.value) })) };
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function addedRates(text: string): number | undefined {
  if (!text.includes('+')) return undefined;
  const parts = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  if (parts.length < 2) return undefined;
  return Math.round(parts.reduce((sum, rate) => sum + rate, 0) * 1000) / 1000;
}

/** A sum that does not equal the lead rate leaves the card. The lead is what remains. */
function withoutBrokenSum(text: string, lead: number): string {
  const kept = text.split(SENTENCE_BREAK).filter((sentence) => {
    const sum = addedRates(sentence);
    return sum === undefined || Math.abs(sum - lead) <= 0.051;
  });
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

const PART_LABEL = /\b(?:city|state|county|local|mctd|mta|metropolitan|surcharge|district|special|transit|municipal)\b/i;
const WHOLE_LABEL = /\b(?:combined|total|overall|effective)\b/i;
const hasRate = (text: string | undefined) => !!text && /\d(?:\.\d+)?\s*(?:%|percent\b)/i.test(text);
/** The rows and tiles of a rate breakdown ("City 4.5% · State 4% · MCTD 0.375%"), filled before the tax passes run. */
let breakdown = new WeakSet<object>();

/**
 * One part of the combined rate keeps its own figure. A row is a part only inside a breakdown: two or more sibling rows
 * or tiles whose labels name a part. A lone "Harbor State sales tax" hero is the rate asked, not a part.
 */
function componentRate(row: object): boolean {
  if (breakdown.has(row)) return true;
  if (NOT_TAX_RATE.test((row as { label?: string }).label ?? '')) return true;
  // "Purchase, NY · Outside NYC, lower rate": a rate the row itself places somewhere else is that place's, not the lead.
  const own = row as { label?: string; sub?: string; caption?: string };
  return OTHER_PLACE.test(`${own.label ?? ''} ${own.sub ?? ''} ${own.caption ?? ''}`);
}
const OTHER_PLACE = /\b(?:outside|elsewhere|other (?:counties|cities|areas|states)|lower rate|higher rate|instead of|compared with|compared to)\b/i;

function markBreakdown(node: CardNode): void {
  // A stat keeps its percent sign in `unit` ("4.5" with unit "%"): that is a rate too.
  const mark = (rows: { label?: string; value?: string; unit?: string }[]) => {
    const parts = rows.filter((row) => row.label && PART_LABEL.test(row.label) && !WHOLE_LABEL.test(row.label) && hasRate(`${row.value ?? ''}${row.unit ? ` ${row.unit}` : ''}`));
    if (parts.length >= 2) parts.forEach((row) => breakdown.add(row));
  };
  if (node.type === 'keyvalue') mark(node.items);
  if ('children' in node && Array.isArray(node.children)) {
    mark(node.children.filter((child): child is Extract<CardNode, { type: 'tile' | 'stat' }> => child.type === 'tile' || child.type === 'stat'));
    node.children.forEach(markBreakdown);
  }
  if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(markBreakdown));
}

function withLeadRate(text: string, lead: number): string {
  if (!/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/i.test(text)) return text;
  return text.replace(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/i, (raw) => (raw.includes('%') ? `${lead}%` : `${lead} percent`));
}

/** A chart or slider whose percents are not the lead rate. Those numbers would disagree with the card. */
function strayRateNode(node: CardNode, lead: number): boolean {
  if (node.type === 'slider') {
    const unit = (node.unit ?? '').toLowerCase();
    return (unit === '%' || unit === 'percent') && Math.abs(node.value - lead) > 0.001;
  }
  if (node.type !== 'chart') return false;
  const unit = (node.unit ?? '').replace(/\s/g, '').toLowerCase();
  const values = node.data.map((item) => item.value);
  const rates = unit === '%' || unit === 'percent' || values.some((value) => value < 1 || !Number.isInteger(value));
  if (!rates) return false;
  return values.some((value) => Math.abs(value - lead) > 0.001);
}

function alignTaxChildren(children: readonly CardNode[], lead: number): CardNode[] {
  return children.map((child) => alignTax(child, lead)).filter((child) => {
    if (strayRateNode(child, lead)) return false;
    if ('children' in child && Array.isArray(child.children) && child.children.length === 0) return false;
    return true;
  });
}

function alignTax(node: CardNode, lead: number): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'scroller': {
      const children = alignTaxChildren(node.children, lead);
      return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    case 'section': {
      const children = alignTaxChildren(node.children, lead);
      if (!children.length) return { type: 'divider' };
      return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: alignTaxChildren(tab.children, lead) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = withoutBrokenSum(node.text, lead);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const value = componentRate(node) ? node.value : withLeadRate(node.value, lead);
      const caption = node.caption ? withoutBrokenSum(node.caption, lead) : node.caption;
      return value === node.value && caption === node.caption ? node : { ...node, value, caption };
    }
    case 'stat': {
      const value = componentRate(node) ? node.value : withLeadRate(node.value, lead);
      return value === node.value ? node : { ...node, value };
    }
    case 'tile': {
      const value = node.value && !componentRate(node) ? withLeadRate(node.value, lead) : node.value;
      const sub = node.sub ? withoutBrokenSum(node.sub, lead) : node.sub;
      return value === node.value && sub === node.sub ? node : { ...node, value, sub };
    }
    case 'keyvalue':
    case 'list':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function statedMoney(text: string, fee: ChargePick, allowed: (value: number) => boolean): string {
  return text.replace(new RegExp(MONEY.source, 'g'), (raw) => {
    const value = moneyValue(raw);
    if (Math.abs(value - fee.value) < 0.001 || allowed(value)) return raw;
    return '';
  }).replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

const ADDON_LINE = /\b(?:expedit(?:e|ed|ing|ion)?|optional|additional|surcharge|add-on|addon)\b/i;

interface NamedCharge {
  figure: string;
  value: number;
  line: string;
  n: number;
  official: boolean;
}

/** Dollar lines from every source. The winning page can name the base charge and omit the add-on. */
function namedCharges(sources: readonly ClaimSource[]): NamedCharge[] {
  const out: NamedCharge[] = [];
  for (const source of sources) {
    const official = officialDomain(source.domain);
    for (const clause of moneyClauses(`${source.text}\n${source.stated ?? ''}`)) {
      out.push({ ...clause, n: source.n, official });
    }
  }
  return out;
}

function wordHit(hay: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(hay);
}

function rowTokens(label: string, weight: number): { token: string; weight: number }[] {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !FEE_GENERIC.has(word));
  const forms = [...label.matchAll(/\b[a-z]{1,4}-\d{2,}\b/gi)].map((match) => match[0].toLowerCase());
  return [...words.map((token) => ({ token, weight })), ...forms.map((token) => ({ token, weight: weight + 2 }))];
}

/**
 * The source line that names this row. A line that says "expedite" is not the base charge,
 * and a line that says the item or its form id is not the add-on.
 */
function chargeForLabel(label: string, sub: string, query: string, charges: readonly NamedCharge[], lead: ChargePick): NamedCharge | undefined {
  const spoken = `${label} ${sub}`.replace(/\+/g, ' and ');
  const tokens = [...rowTokens(label, 2), ...rowTokens(sub, 1)];
  const addonLabel = ADDON_LINE.test(spoken);
  const questionAddon = ADDON_LINE.test(query);
  if (!tokens.length && !addonLabel) return undefined;
  let best: { charge: NamedCharge; score: number; hits: number } | undefined;
  for (const charge of charges) {
    const low = charge.line.toLowerCase();
    let score = 0;
    let hits = 0;
    for (const token of tokens) {
      if (!wordHit(low, token.token)) continue;
      score += token.weight;
      if (token.weight >= 2) hits += 1;
    }
    const lineAddon = ADDON_LINE.test(charge.line);
    if (addonLabel && !questionAddon) score += lineAddon ? 3 : -6;
    else if (!addonLabel && !questionAddon && lineAddon) score -= 4;
    if (/\band\s+[a-z]/i.test(charge.line) && !/\band\b/i.test(spoken)) score -= 4;
    if (score < 2) continue;
    const leadCopy = Math.abs(charge.value - lead.value) < 0.001;
    const bestCopy = best ? Math.abs(best.charge.value - lead.value) < 0.001 : false;
    // "$42 Harbor card" names the next item. "Harbor card: $11" names this one.
    // An add-on keeps the line that says so, including when that line leads with the amount.
    const namedFirst = !/^[$£€¥]/.test(charge.line.trim());
    const bestNamed = best ? !/^[$£€¥]/.test(best.charge.line.trim()) : false;
    const sameOrder = !best || addonLabel || namedFirst === bestNamed;
    const closer = !best
      || score > best.score
      || (score === best.score && hits > best.hits)
      || (score === best.score && hits === best.hits && !addonLabel && namedFirst && !bestNamed)
      || (score === best.score && hits === best.hits && sameOrder && charge.official && !best.charge.official)
      || (score === best.score && hits === best.hits && sameOrder && charge.official === best.charge.official && addonLabel && !questionAddon && !leadCopy && bestCopy);
    if (closer) best = { charge, score, hits };
  }
  return best?.charge;
}

/** The row is the charge the question asked for, not a different add-on listed beside it. */
function asksForCharge(label: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !FEE_GENERIC.has(word));
  if (!tokens.length) return false;
  if (ADDON_LINE.test(label) && !ADDON_LINE.test(query)) return false;
  const low = label.toLowerCase();
  const hits = tokens.filter((token) => low.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

/** One shown amount, tied to the line that names its row. The base charge is not copied onto a different row. */
function pickedAmount(
  label: string,
  sub: string,
  raw: string,
  fee: ChargePick,
  allowed: (value: number) => boolean,
  query: string,
  charges: readonly NamedCharge[],
): string {
  const named = chargeForLabel(label, sub, query, charges, fee);
  const value = moneyValue(raw);
  const addonRow = ADDON_LINE.test(`${label} ${sub}`) && !ADDON_LINE.test(query);
  if (named && Math.abs(value - named.value) < 0.001) return raw.replace(/\s/g, '');
  if (named && (Math.abs(named.value - fee.value) >= 0.001 || !addonRow)) return named.figure;
  if (addonRow && charges.some((charge) => Math.abs(charge.value - value) < 0.001 && ADDON_LINE.test(charge.line))) return raw.replace(/\s/g, '');
  if (addonRow && Math.abs(value - fee.value) < 0.001) return '';
  if (asksForCharge(label, query) && Math.abs(value - fee.value) >= 0.001) return fee.amount;
  if (Math.abs(value - fee.value) < 0.001 || allowed(value)) return raw;
  return '';
}

function rewriteMoney(
  label: string,
  sub: string,
  text: string,
  fee: ChargePick,
  allowed: (value: number) => boolean,
  query: string,
  charges: readonly NamedCharge[],
): string {
  if (!MONEY.test(text)) return text;
  let cite: number | undefined;
  const replaced = text.replace(new RegExp(MONEY.source, 'g'), (raw, index: number) => {
    const local = label === text ? figureClause(text, index, raw.length) : label;
    const localSub = label === text ? '' : sub;
    const next = pickedAmount(local, localSub, raw, fee, allowed, query, charges);
    const named = chargeForLabel(local, localSub, query, charges, fee);
    if (named && next.replace(/\s/g, '') === named.figure && Math.abs(moneyValue(raw) - named.value) >= 0.001) cite = named.n;
    return next;
  });
  const cited = cite === undefined ? replaced : replaced.replace(/\[(\d+)\]/, `[${cite}]`);
  return cited.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/** The lead amount is the official charge. The hero is that charge. A different row keeps the line that names it. */
function alignFee(
  node: CardNode,
  fee: ChargePick,
  allowed: (value: number) => boolean,
  query: string,
  charges: readonly NamedCharge[],
): CardNode {
  const line = (text: string) => statedMoney(text, fee, allowed);
  const lead = (text: string) => {
    if (!MONEY.test(text)) return fee.amount;
    const value = moneyValue(text.match(MONEY)?.[0] ?? '');
    if (Math.abs(value - fee.value) < 0.001) return line(text);
    return text.replace(MONEY, fee.amount);
  };
  const tied = (label: string, sub: string, text: string) => rewriteMoney(label, sub, text, fee, allowed, query, charges);
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => alignFee(child, fee, allowed, query, charges)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => alignFee(child, fee, allowed, query, charges)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = tied(node.text, '', node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const value = lead(node.value);
      return value === node.value ? node : { ...node, value };
    }
    case 'stat': {
      const addonRow = ADDON_LINE.test(node.label) && !ADDON_LINE.test(query);
      const value = addonRow ? tied(node.label, '', node.value) : lead(node.value);
      return value === node.value ? node : { ...node, value };
    }
    case 'tile': {
      const named = node.value ? chargeForLabel(node.label, node.sub ?? '', query, charges, fee) : undefined;
      const value = node.value ? tied(node.label, node.sub ?? '', node.value) : node.value;
      const sub = node.sub ? tied(node.label, node.sub, node.sub) : node.sub;
      const shown = value?.match(MONEY)?.[0];
      const moved = named && shown && Math.abs(moneyValue(shown) - named.value) < 0.001 && Math.abs(named.value - fee.value) >= 0.001;
      if (value === node.value && sub === node.sub && !moved) return node;
      return moved ? { ...node, value, sub, source: named.n } : { ...node, value, sub };
    }
    case 'keyvalue':
      return { ...node, items: node.items.map((item) => ({ ...item, value: tied(item.label, '', item.value) })) };
    case 'list':
      return {
        ...node,
        items: node.items.map((item) => ({ ...item, text: tied(item.text, '', item.text), meta: item.meta ? tied(item.meta, '', item.meta) : item.meta })),
      };
    case 'table':
      return { ...node, rows: node.rows.map((cells) => cells.map((cell, index) => (index === 0 ? cell : tied(cells[0] ?? '', '', cell)))) };
    case 'timeline':
    case 'profile':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

const CHARGE_GENERIC = new Set([
  'adult', 'minor', 'mail', 'form', 'optional', 'extra', 'added', 'service', 'processing',
  'renewal', 'cost', 'costs', 'total', 'payable', 'state', 'regular', 'standard', 'current',
]);

/** The charge a row names. "Expedited" and "Expedited add-on" are one charge. "Book" and "book and card" are not. */
function chargeName(label: string): string | undefined {
  const words = label.toLowerCase().replace(/\+/g, ' and ').split(/[^a-z0-9]+/).flatMap((word) => {
    if (word.length < 4 || FEE_GENERIC.has(word) || CHARGE_GENERIC.has(word)) return [];
    if (/^expedit/.test(word)) return ['expedite'];
    return [word];
  });
  const forms = [...label.matchAll(/\b[a-z]{1,4}-\d{2,}\b/gi)].map((match) => match[0].toLowerCase());
  const parts = [...new Set([...words, ...forms])].sort();
  return parts.length ? parts.join('|') : undefined;
}

/** Keep the first row that names a charge. The same name, or the same word at the same amount, is not added again. */
function keepCharge(label: string, text: string, seen: Set<string>, hero?: { name: string; amount: number }): boolean {
  if (!MONEY.test(text) && !MONEY.test(label)) return true;
  const amount = moneyValue((text.match(MONEY) ?? label.match(MONEY))?.[0] ?? '');
  const name = chargeName(label);
  // The hero is the charge that was asked for. Another row at that same amount is a second copy.
  if (hero && Number.isFinite(amount) && Math.abs(amount - hero.amount) < 0.001) return false;
  if (!name) return true;
  const tokens = name.split('|');
  const repeated = seen.has(name) || (Number.isFinite(amount) && tokens.some((token) => seen.has(`${token}@${amount}`)));
  if (repeated) return false;
  seen.add(name);
  if (Number.isFinite(amount)) for (const token of tokens) seen.add(`${token}@${amount}`);
  return true;
}

function dropRepeatCharge(node: CardNode, seen: Set<string>, hero?: { name: string; amount: number }): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.flatMap((child) => {
        const next = dropRepeatCharge(child, seen, hero);
        return next ? [next] : [];
      });
      return children.length ? { ...node, children } : undefined;
    }
    case 'tabs':
      return {
        ...node,
        tabs: node.tabs.map((tab) => ({
          ...tab,
          children: tab.children.flatMap((child) => {
            const next = dropRepeatCharge(child, seen, hero);
            return next ? [next] : [];
          }),
        })),
      };
    case 'tile':
    case 'stat':
      return keepCharge(node.label, `${node.value ?? ''} ${node.type === 'tile' ? node.sub ?? '' : ''}`, seen, hero) ? node : undefined;
    case 'keyvalue': {
      const items = node.items.filter((item) => keepCharge(item.label, item.value, seen, hero));
      return items.length ? (items.length === node.items.length ? node : { ...node, items }) : undefined;
    }
    case 'table': {
      const rows = node.rows.filter((row) => keepCharge(row[0] ?? '', row.slice(1).join(' '), seen, hero));
      return rows.length ? (rows.length === node.rows.length ? node : { ...node, rows }) : undefined;
    }
    case 'list': {
      const items = node.items.filter((item) => keepCharge(item.text, `${item.text} ${item.meta ?? ''}`, seen, hero));
      return items.length ? (items.length === node.items.length ? node : { ...node, items }) : undefined;
    }
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'hero':
    case 'timeline':
    case 'profile':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function heroCharge(node: CardNode): { name: string; amount: number } | undefined {
  if (node.type === 'hero') {
    const amount = moneyValue(node.value.match(MONEY)?.[0] ?? '');
    if (!Number.isFinite(amount)) return undefined;
    return { name: chargeName(node.label ?? '') ?? '', amount };
  }
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    for (const child of node.children) {
      const found = heroCharge(child);
      if (found) return found;
    }
  }
  if (node.type === 'tabs') {
    for (const tab of node.tabs) {
      for (const child of tab.children) {
        const found = heroCharge(child);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** One row per named charge, across the whole card. The hero is the answer, not a second copy of a row. */
export function oneNamedCharge(query: string, nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  if (!FEE_ASK.test(query) || TAX_ASK.test(query)) return [...nodes];
  const seen = new Set<string>();
  let hero: { name: string; amount: number } | undefined;
  for (const node of nodes) {
    if (!node) continue;
    hero = heroCharge(node);
    if (hero) break;
  }
  return nodes.map((node) => (node ? dropRepeatCharge(node, seen, hero) : node));
}

function questionTokens(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !FEE_GENERIC.has(word) && !CHARGE_GENERIC.has(word));
}

/** Words that sit in front of the amount. A figure that leads the clause has not named its item yet. */
function labelBeforeAmount(line: string): string | undefined {
  const money = line.match(MONEY);
  if (!money || money.index === undefined || money.index === 0 || /^[$£€¥]/.test(line.trim())) return undefined;
  const words = line.slice(0, money.index).replace(/[^A-Za-z0-9\s+-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((word) => word.length >= 3);
  const kept = words.slice(-5);
  return kept.length ? kept.join(' ') : undefined;
}

/** An add-on written after its amount ("$15—Expedited") still names that add-on. */
function addonAfterAmount(line: string): string | undefined {
  const money = line.match(MONEY);
  if (!money || money.index === undefined) return undefined;
  const words = line.slice(money.index + money[0].length).replace(/[^A-Za-z0-9\s+-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 3);
  const label = words.join(' ');
  return label && ADDON_LINE.test(label) ? label : undefined;
}

function recordCharges(node: CardNode, seen: Set<string>): void {
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    for (const child of node.children) recordCharges(child, seen);
    return;
  }
  if (node.type === 'tabs') {
    for (const tab of node.tabs) for (const child of tab.children) recordCharges(child, seen);
    return;
  }
  if (node.type === 'tile' || node.type === 'stat') {
    keepCharge(node.label, `${node.value ?? ''} ${node.type === 'tile' ? node.sub ?? '' : ''}`, seen);
    return;
  }
  if (node.type === 'keyvalue') {
    for (const item of node.items) keepCharge(item.label, item.value, seen);
    return;
  }
  if (node.type === 'table') {
    for (const row of node.rows) keepCharge(row[0] ?? '', row.slice(1).join(' '), seen);
    return;
  }
  if (node.type === 'list') {
    for (const item of node.items) keepCharge(item.text, `${item.text} ${item.meta ?? ''}`, seen);
  }
}

function placeCharge(node: CardNode, tile: CardNode): CardNode | undefined {
  if (node.type === 'grid') return { ...node, children: [...node.children, tile] };
  if (node.type === 'keyvalue' && tile.type === 'tile') return { ...node, items: [...node.items, { label: tile.label, value: tile.value ?? '' }] };
  if (node.type === 'stack' || node.type === 'section' || node.type === 'scroller') {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) continue;
      const placed = placeCharge(child, tile);
      if (!placed) continue;
      const children = node.children.slice();
      children[i] = placed;
      return { ...node, children };
    }
    return { ...node, children: [...node.children, tile] };
  }
  return undefined;
}

/**
 * A fee card shows each distinct charge a source names, once.
 * The lead amount stays the hero. A second row for that same charge is not added.
 */
export function presentNamedCharges(query: string, nodes: readonly (CardNode | undefined)[], sources: readonly ClaimSource[]): (CardNode | undefined)[] {
  if (!FEE_ASK.test(query) || TAX_ASK.test(query)) return [...nodes];
  const lead = officialCharge(query, sources);
  if (!lead) return [...nodes];
  const charges = namedCharges(sources);
  const asked = questionTokens(query);
  const labels: string[] = [];
  const seenLabels = new Set<string>();
  const consider = (label: string | undefined) => {
    if (!label) return;
    const name = chargeName(label);
    if (!name || seenLabels.has(name)) return;
    const shares = asked.some((token) => wordHit(label, token));
    if (/\b(?:for|the|pay|paid|this|that|with|from|when|where|your)\b/i.test(label)) return;
    if (!shares && !ADDON_LINE.test(label)) return;
    seenLabels.add(name);
    labels.push(label);
  };
  for (const charge of charges) consider(labelBeforeAmount(charge.line));
  for (const charge of charges) consider(addonAfterAmount(charge.line));
  const seen = new Set<string>();
  for (const node of nodes) if (node) recordCharges(node, seen);
  const tiles: CardNode[] = [];
  for (const label of labels) {
    if (tiles.length >= 6) break;
    const named = chargeForLabel(label, '', query, charges, lead);
    if (!named || Math.abs(named.value - lead.value) < 0.001) continue;
    if (!keepCharge(label, named.figure, seen)) continue;
    tiles.push({ type: 'tile', label, value: named.figure, source: named.n });
  }
  if (!tiles.length) return [...nodes];
  const next = nodes.map((node) => node);
  for (const tile of tiles) {
    let placed = false;
    for (let i = 0; i < next.length; i++) {
      const node = next[i];
      if (!node) continue;
      const host = placeCharge(node, tile);
      if (!host) continue;
      next[i] = host;
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return next;
}

/** The last pass: every percent on a tax card is the official rate, including nodes added after the first bind. */
export function agreeOfficialRate(node: CardNode, query: string, sources: readonly ClaimSource[]): CardNode {
  const tax = salesTax(query, sources);
  if (!tax) return node;
  // The card's breakdown rows ("City 4.5% · State 4% · MCTD 0.375%") are marked again: this pass runs on the finished
  // card, after the marks from designing it were made on other objects.
  breakdown = new WeakSet<object>();
  markBreakdown(node);
  return alignTax(applyTax(node, query, tax, ratesIn(sources.find((source) => source.n === tax.n))), tax.rate);
}

/** Move each number's citation onto a page that states it, then fill a missing product price from that page. */
export function bindClaims(node: CardNode, sources: readonly ClaimSource[], query: string): CardNode {
  if (!sources.length) return node;
  const aimed = retargetNode(node, sources, query);
  const tax = salesTax(query, sources);
  breakdown = new WeakSet<object>();
  if (tax) markBreakdown(aimed);
  const taxed = tax ? alignTax(applyTax(aimed, query, tax, ratesIn(sources.find((source) => source.n === tax.n))), tax.rate) : aimed;
  const lined = TAX_ASK.test(query) ? repairTaxNode(taxed, query, sources) : taxed;
  const fee = officialCharge(query, sources);
  const allowed = officialAmounts(sources.find((source) => source.n === fee?.n));
  const charged = fee ? alignFee(applyCharge(lined, fee, allowed), fee, allowed, query, namedCharges(sources)) : lined;
  if (!shoppingAsk(query)) return charged;
  const ceilings = budgetAmounts(query);
  return dropPriceless(keepBudgetPrices(fillPrices(charged, sources, ceilings), ceilings), ceilings, query);
}
