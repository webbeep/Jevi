import type { CardNode } from '../shared/card';
import { SENTENCE_BREAK, joinSpacedDecimals } from '../shared/text';
import { factAnswer } from './hops';
import { numberTokens } from './ground';
import { completeCutDecimal, withoutEmptySlots } from './polish';
import { dropInventedTitles, finishQuotedText, honestHero, honestStudyText, peerPaperItems, peerPaperSource } from './cardAgree';

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
  const quantities = text.replace(/\[\d+\]/g, '').replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ');
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

function stripNums(text: string, nums: readonly string[]): string {
  const masked = maskQuotes(text);
  let out = masked.text;
  for (const num of nums) {
    const bare = bareNumber(num);
    // "A 2024 imaging" loses the year and must not stay "A imaging". Only the article that sat on that number goes.
    out = out.replace(new RegExp(`\\bA\\s+${bare}\\s+(?=[aeiou])`, 'gi'), '');
    out = out.replace(new RegExp(`\\bAn\\s+${bare}\\s+(?=[bcdfghjklmnpqrstvwxyz])`, 'gi'), '');
    out = out.replace(shownNumber(num), ' ');
  }
  out = unmaskQuotes(out, masked.quotes);
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim();
  return withoutEmptySlots(out);
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
  const parts = joined.split(SENTENCE_BREAK);
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
      const cited = retargetCites(node.text, sources, query);
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
  for (const source of sources) {
    const official = officialDomain(source.domain);
    const body = `${source.text}\n${source.stated ?? ''}`;
    const head = (body.split('\n')[0] ?? '').toLowerCase();
    const sentences = body.split(SENTENCE_BREAK);
    for (const sentence of sentences) {
      const percents = [...sentence.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
      if (!percents.length) continue;
      const low = sentence.toLowerCase();
      const blob = `${head} ${low}`;
      const namesPlace = place.length > 0 && (place.every((word) => blob.includes(word)) || (place.includes('nyc') && blob.includes('new york')));
      const aboutPlace = place.length === 0 || namesPlace;
      const combined = /\b(combined|total|overall)\b/i.test(sentence);
      const stateOnly = /\bstate\b/i.test(sentence) && !combined;
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
        for (const word of questionWords(query)) if (low.includes(word)) score += 4;
        if (otherPlace(sentence, query)) score -= 20;
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
    if (QUESTION_SKIP.has(word)) return false;
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

function applyTaxText(text: string, query: string, pick: TaxPick, _keep: ReadonlySet<number>): string {
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = price ? Number(price[1]!.replace(/,/g, '')) : undefined;
  const shown = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/gi)].map((match) => Number(match[1]));
  const wrong = shown.find((rate) => Math.abs(rate - pick.rate) > 0.001);
  if (wrong === undefined) return text;
  let out = text.replace(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/gi, (raw, num) => {
    if (Math.abs(Number(num) - pick.rate) <= 0.001) return raw;
    return raw.includes('%') ? `${pick.rate}%` : `${pick.rate} percent`;
  });
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
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => applyTax(child, query, pick, keep)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => applyTax(child, query, pick, keep)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = applyTaxText(node.text, query, pick, keep);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const caption = node.caption ? applyTaxText(node.caption, query, pick, keep) : node.caption;
      const value = applyTaxText(node.value, query, pick, keep);
      return caption === node.caption && value === node.value ? node : { ...node, caption, value };
    }
    case 'tile': {
      const value = node.value ? applyTaxText(node.value, query, pick, keep) : node.value;
      const sub = node.sub ? applyTaxText(node.sub, query, pick, keep) : node.sub;
      return value === node.value && sub === node.sub ? node : { ...node, value, sub, source: node.source ?? pick.n };
    }
    case 'stat': {
      const value = applyTaxText(node.value, query, pick, keep);
      return value === node.value ? node : { ...node, value };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = applyTaxText(item.value, query, pick, keep);
        return value === item.value ? item : { ...item, value };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
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
      return { ...node, value: node.value ? line(node.value) : node.value, sub: node.sub ? line(node.sub) : node.sub };
    case 'stat':
      return { ...node, value: line(node.value), label: line(node.label) };
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

function feeWords(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !FEE_GENERIC.has(word));
}

function labeledFee(sentence: string): { raw: string; value: number } | undefined {
  const labeled = sentence.match(/(?:fee|fees|fine|fines|toll|tolls|duty|duties|surcharge|levy|cost|charge|total|price|costs?|is|of)\s*(?:is|of|:)?\s*(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const raw = labeled?.[1] ?? sentence.match(MONEY)?.[0];
  if (!raw) return undefined;
  return { raw: raw.replace(/\s/g, ''), value: moneyValue(raw) };
}

/**
 * The dollar amount an official page states for this fee. A different amount on another site,
 * including a remembered round number, is not the charge.
 */
export function officialCharge(query: string, sources: readonly ClaimSource[]): ChargePick | undefined {
  if (!FEE_ASK.test(query) || TAX_ASK.test(query)) return undefined;
  const want = feeWords(query);
  let best: ChargePick & { score: number } | undefined;
  for (const source of sources) {
    if (!officialDomain(source.domain)) continue;
    for (const sentence of `${source.text}\n${source.stated ?? ''}`.split(SENTENCE_BREAK)) {
      const money = labeledFee(sentence);
      if (!money) continue;
      const low = sentence.toLowerCase();
      const title = (source.text.split('\n')[0] ?? '').toLowerCase();
      let score = 1;
      for (const word of want) {
        if (low.includes(word)) score += 3;
        if (title.includes(word)) score += 2;
      }
      if (/\btotal\b/i.test(sentence)) score += 2;
      if (/\bcard\b/i.test(low) && !/\bcard\b/i.test(query)) score -= 4;
      if (!best || score > best.score) best = { amount: money.raw, value: money.value, n: source.n, score };
    }
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

function withLeadRate(text: string, lead: number): string {
  if (!/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/i.test(text)) return text;
  return text.replace(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent\b)/i, (raw) => (raw.includes('%') ? `${lead}%` : `${lead} percent`));
}

function alignTax(node: CardNode, lead: number): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => alignTax(child, lead)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => alignTax(child, lead)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = withoutBrokenSum(node.text, lead);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const value = withLeadRate(node.value, lead);
      const caption = node.caption ? withoutBrokenSum(node.caption, lead) : node.caption;
      return value === node.value && caption === node.caption ? node : { ...node, value, caption };
    }
    case 'stat': {
      const value = withLeadRate(node.value, lead);
      return value === node.value ? node : { ...node, value };
    }
    case 'tile': {
      const value = node.value ? withLeadRate(node.value, lead) : node.value;
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

/** The lead amount is the official charge. A different amount the official page does not state goes. */
function alignFee(node: CardNode, fee: ChargePick, allowed: (value: number) => boolean): CardNode {
  const line = (text: string) => statedMoney(text, fee, allowed);
  const lead = (text: string) => {
    if (!MONEY.test(text)) return line(text);
    const value = moneyValue(text.match(MONEY)?.[0] ?? '');
    if (Math.abs(value - fee.value) < 0.001 || allowed(value)) return line(text);
    return fee.amount;
  };
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => alignFee(child, fee, allowed)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => alignFee(child, fee, allowed)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = line(node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero':
    case 'stat': {
      const value = lead(node.type === 'hero' ? node.value : node.value);
      return value === (node.type === 'hero' ? node.value : node.value) ? node : { ...node, value };
    }
    case 'tile': {
      const value = node.value ? lead(node.value) : node.value;
      const sub = node.sub ? line(node.sub) : node.sub;
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

/** Move each number's citation onto a page that states it, then fill a missing product price from that page. */
export function bindClaims(node: CardNode, sources: readonly ClaimSource[], query: string): CardNode {
  if (!sources.length) return node;
  const aimed = retargetNode(node, sources, query);
  const tax = salesTax(query, sources);
  const taxed = tax ? alignTax(applyTax(aimed, query, tax, ratesIn(sources.find((source) => source.n === tax.n))), tax.rate) : aimed;
  const lined = TAX_ASK.test(query) ? repairTaxNode(taxed, query, sources) : taxed;
  const fee = officialCharge(query, sources);
  const charged = fee ? alignFee(applyCharge(lined, fee, officialAmounts(sources.find((source) => source.n === fee.n))), fee, officialAmounts(sources.find((source) => source.n === fee.n))) : lined;
  if (!shoppingAsk(query)) return charged;
  const ceilings = budgetAmounts(query);
  return dropPriceless(keepBudgetPrices(fillPrices(charged, sources, ceilings), ceilings), ceilings, query);
}
