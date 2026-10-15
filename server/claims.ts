import type { CardNode } from '../shared/card';
import { factAnswer } from './hops';
import { numberTokens } from './ground';
import { withoutEmptySlots } from './polish';

/** One search result, numbered the way the card cites it, with the text the card was allowed to use. */
export interface ClaimSource {
  n: number;
  text: string;
  /** Host the citation points at, when the result has one. */
  domain?: string;
}

const FREE = 2;
const SHOPPING = /(?:^|\b)(?:best|top|cheap|budget|affordable)\b/i;
const PRODUCT = /(?:\$\s?\d|\b(?:buy|price|prices|deal|deals|laptop|phone|tablet|headphone|monitor|camera|keyboard|tv|shoe)s?\b)/i;
/** "Best ways to…" is advice. "Best HDMI cable" is a product list even when the noun is not in a list. */
const ADVICE = /\b(?:ways|tips|practices|methods|reasons|ideas|strategies|habits)\b/i;
const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
const BUDGET = /\b(?:under|below|less than|cheaper than|up to|at most)\b/i;
const TAX_ASK = /\b(?:sales\s+tax|tax)\b/i;
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
    if (BUDGET.test(lead) && ceilings.includes(value)) continue;
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
    // A fetched page is the citation. A number that exists only in the snippet is not on that page.
    const text = read
      ? `${result.title ?? ''}\n${read}`
      : `${result.title ?? ''} ${result.snippet ?? ''} ${result.content ?? ''}`;
    return { n: index + 1, text, domain: result.domain };
  });
}

export function shoppingAsk(query: string): boolean {
  if (ADVICE.test(query) || !SHOPPING.test(query)) return false;
  if (PRODUCT.test(query)) return true;
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

function stripNums(text: string, nums: readonly string[]): string {
  let out = text;
  for (const num of nums) out = out.replace(shownNumber(num), ' ');
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim();
  return withoutEmptySlots(out);
}

/** A number the sources imply: an age, a rounded quotient, a century, the newest score, the event's year. */
function keepsDerived(query: string, text: string, sources: readonly ClaimSource[]): boolean {
  if (!query || !text) return false;
  const answer = factAnswer(query, sources.map((source) => source.text).join('\n'));
  return !!answer && text.toLowerCase().includes(answer.lead.toLowerCase());
}

/** Point each cited number at a page that contains it, and drop a number no cited page states. */
export function retargetCites(text: string, sources: readonly ClaimSource[], query = ''): string {
  if (!sources.length) return withoutEmptySlots(text);
  if (!/\d/.test(text)) return withoutEmptySlots(text);
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.flatMap((sentence) => {
    const nums = significant(sentence);
    if (!nums.length) return [sentence];
    const cites = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    if (cites.length && cites.every((n) => covers(byNumber(sources, n), nums))) return [withoutEmptySlots(sentence)];
    const page = sources.find((source) => covers(source, nums))?.n ?? bestPage(nums, sources, cites);
    if (!page) {
      if (keepsDerived(query, sentence, sources)) return [sentence];
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

function citeValue(text: string, sources: readonly ClaimSource[], current: number | undefined): number | undefined {
  const nums = significant(text);
  if (!nums.length) return current;
  if (current && covers(byNumber(sources, current), nums)) return current;
  return sources.find((source) => covers(source, nums))?.n ?? (current && nums.some((num) => has(byNumber(sources, current), num)) ? current : undefined);
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
      const text = cited.split(/(?<=[.!?])\s+/).map((sentence) => {
        const n = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])).at(-1);
        return withoutForeignAgency(sentence, byNumber(sources, n ?? 0));
      }).join(' ');
      return text === node.text ? node : { ...node, text };
    }
    case 'heading': {
      const text = retargetCites(node.text, sources, query);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const caption = node.caption ? retargetCites(node.caption, sources, query) : node.caption;
      const nums = significant(node.value);
      const page = citeValue(node.value, sources, undefined);
      if (!page && keepsDerived(query, node.value, sources)) {
        return caption === node.caption ? node : { ...node, caption };
      }
      if (!page) {
        const stripped = nums.length ? stripNums(node.value, nums) : node.value;
        const value = stripped && /\d/.test(stripped) ? stripped : nums.length ? '' : node.value;
        return value === node.value && caption === node.caption ? node : { ...node, value, caption };
      }
      const already = caption ? [...caption.matchAll(/\[(\d+)\]/g)].some((match) => Number(match[1]) === page) : false;
      const next = already ? caption : `${caption ? `${caption.replace(/\s*\[\d+\]/g, '').trim()} ` : ''}[${page}]`.trim();
      return next === node.caption ? node : { ...node, caption: next };
    }
    case 'tile': {
      const valueNums = significant(node.value ?? '');
      let value = node.value;
      let source = node.source;
      if (valueNums.length) {
        const full = node.source && covers(byNumber(sources, node.source), valueNums)
          ? node.source
          : sources.find((item) => covers(item, valueNums))?.n;
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
        const text = retargetCites(item.text, sources);
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
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
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
    case 'profile':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
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

/**
 * The rate that applies to the purchase the question names. A city question uses the combined
 * local rate a source states, and a threshold on that page ("under $110") decides which rate.
 */
export function salesTax(query: string, sources: readonly ClaimSource[]): TaxPick | undefined {
  if (!TAX_ASK.test(query) || !sources.length) return undefined;
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = price ? Number(price[1]!.replace(/,/g, '')) : undefined;
  const place = placePhrase(query);
  let best: { rate: number; n: number; score: number } | undefined;
  for (const source of sources) {
    const sentences = source.text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const percents = [...sentence.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
      if (!percents.length) continue;
      const low = sentence.toLowerCase();
      const namesPlace = place.length > 0 && (place.every((word) => low.includes(word)) || (place.includes('nyc') && low.includes('new york')));
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
        if (combined) score += 3;
        if (stateOnly) score -= 3;
        if (aboveCut && forBelow && !forAbove && !combined) score -= 5;
        if (belowCut && combined && forBelow) score -= 4;
        if (aboveCut && (combined || forAbove)) score += 3;
        if (!best || score > best.score) best = { rate, n: source.n, score };
      }
    }
  }
  if (!best || best.score < 1) return undefined;
  return { rate: best.rate, n: best.n };
}

function applyTaxText(text: string, query: string, pick: TaxPick): string {
  const price = query.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = price ? Number(price[1]!.replace(/,/g, '')) : undefined;
  const shown = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  const wrong = shown.find((rate) => Math.abs(rate - pick.rate) > 0.001);
  if (wrong === undefined) return text;
  let out = text.replace(/(\d{1,2}(?:\.\d+)?)\s*%/, `${pick.rate}%`);
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

function applyTax(node: CardNode, query: string, pick: TaxPick): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => applyTax(child, query, pick)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => applyTax(child, query, pick)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = applyTaxText(node.text, query, pick);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const caption = node.caption ? applyTaxText(node.caption, query, pick) : node.caption;
      const value = applyTaxText(node.value, query, pick);
      return caption === node.caption && value === node.value ? node : { ...node, caption, value };
    }
    case 'tile': {
      const value = node.value ? applyTaxText(node.value, query, pick) : node.value;
      const sub = node.sub ? applyTaxText(node.sub, query, pick) : node.sub;
      return value === node.value && sub === node.sub ? node : { ...node, value, sub, source: node.source ?? pick.n };
    }
    case 'stat': {
      const value = applyTaxText(node.value, query, pick);
      return value === node.value ? node : { ...node, value };
    }
    case 'keyvalue': {
      const items = node.items.map((item) => {
        const value = applyTaxText(item.value, query, pick);
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

/** A priced list drops a pick that still has no price. A list with no prices at all stays, so a miss does not empty the card. */
function dropPriceless(node: CardNode, ceilings: readonly number[]): CardNode {
  switch (node.type) {
    case 'list': {
      const priced = node.items.filter((item) => hasPrice(item.meta, ceilings) || hasPrice(item.text, ceilings));
      if (!priced.length || priced.length === node.items.length) return node;
      return { ...node, items: priced };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => dropPriceless(child, ceilings)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => dropPriceless(child, ceilings)) })) };
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

/** The verb in this sentence is about this person, and the sentence is not a group or theme credit. */
function attributesAct(sentence: string, person: string, act: string | undefined, clues: readonly string[]): boolean {
  const last = lastOf(person);
  if (last.length < 3) return false;
  const lower = sentence.toLowerCase();
  const topical = (act ? lower.includes(act) : false) || clues.some((clue) => clue.length >= 5 && lower.includes(clue));
  if (!topical) return false;
  if (/\btheme\s+(?:song|video)\b/i.test(sentence)) return false;
  if (/\b(?:the\s+)?(?:main\s+|entire\s+|whole\s+)?cast\b/i.test(sentence) && !new RegExp(`\\b${escapeName(last)}\\s+(?:appeared|appears|starred|featured|was|is)\\b`, 'i').test(sentence)) return false;
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
      const sentence = sentenceAt(text, match.index ?? 0);
      if (!attributesAct(sentence, person, act, clues)) continue;
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
      const window = sentenceAt(text, mark.index ?? 0);
      const names = [...new Set(peopleIn(window))];
      if (names.length < 3) continue;
      names.forEach((name) => found.add(name));
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
      const text = node.text.split(/(?<=[.!?])\s+/).filter((sentence) => !ABSTAIN.test(sentence)).join(' ').trim();
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
        const rows = node.rows.map((row) => {
          const person = row.reduce<string | undefined>((found, cell) => found ?? properName(cell), undefined);
          if (!person) return row;
          const blob = row.join(' ');
          if (!affirmsAppearance(blob)) return row;
          if (!unsupported(person, appearanceClues(row, person))) return row;
          changed = true;
          return row.map((cell) => {
            if (/\byes\b/i.test(cell)) return 'No';
            if (properName(cell) === person) return cell;
            return workWords(cell).length ? '' : cell;
          });
        });
        return { ...node, rows };
      }
      case 'text':
      case 'callout':
      case 'quote':
      case 'draft': {
        const kept = node.text.split(/(?<=[.!?])\s+/).filter((sentence) => {
          if (!denySentence(sentence)) return true;
          changed = true;
          return false;
        });
        const text = kept.join(' ').trim();
        return text === node.text ? node : { ...node, text };
      }
      case 'heading':
      case 'hero':
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

/** Move each number's citation onto a page that states it, then fill a missing product price from that page. */
export function bindClaims(node: CardNode, sources: readonly ClaimSource[], query: string): CardNode {
  if (!sources.length) return node;
  const aimed = retargetNode(node, sources, query);
  const tax = salesTax(query, sources);
  const taxed = tax ? applyTax(aimed, query, tax) : aimed;
  if (!shoppingAsk(query)) return taxed;
  const ceilings = budgetAmounts(query);
  return dropPriceless(fillPrices(taxed, sources, ceilings), ceilings);
}
