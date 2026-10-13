import type { CardNode } from '../shared/card';
import { numberTokens } from './ground';

/** One search result, numbered the way the card cites it, with the text the card was allowed to use. */
export interface ClaimSource {
  n: number;
  text: string;
}

const FREE = 2;
const SHOPPING = /(?:^|\b)(?:best|top|cheap|budget|affordable)\b/i;
const PRODUCT = /(?:\$\s?\d|\b(?:buy|price|prices|deal|deals|laptop|phone|tablet|headphone|monitor|camera|keyboard|tv|shoe)s?\b)/i;
const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
const BUDGET = /\b(?:under|below|less than|cheaper than|up to|at most)\b/i;
const TAX_ASK = /\b(?:sales\s+tax|tax)\b/i;
const PRICE_STOP = new Set(['best', 'top', 'under', 'with', 'for', 'the', 'and', 'laptop', 'laptops', 'buy', 'cheap', 'budget', 'new', 'from', 'than', 'that', 'this']);

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
  results: readonly { title?: string; snippet?: string; content?: string }[],
  pages: readonly { n: number; text: string }[],
): ClaimSource[] {
  const page = new Map(pages.map((item) => [item.n, item.text]));
  return results.map((result, index) => ({
    n: index + 1,
    text: `${result.title ?? ''} ${result.snippet ?? ''} ${result.content ?? ''} ${page.get(index + 1) ?? ''}`,
  }));
}

export function shoppingAsk(query: string): boolean {
  return SHOPPING.test(query) && PRODUCT.test(query);
}

function significant(text: string): string[] {
  return numberTokens(text.replace(/\[\d+\]/g, '')).filter((num) => Number(num) > FREE);
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
  if (num.includes('.')) return new RegExp(`\\$?\\s*${num.replace('.', '\\.')}`, 'g');
  const groups: string[] = [];
  let rest = num;
  while (rest.length > 3) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return new RegExp(`\\$?\\s*${groups.join(',?')}(?:\\.0+)?`, 'g');
}

function stripNums(text: string, nums: readonly string[]): string {
  let out = text;
  for (const num of nums) out = out.replace(shownNumber(num), ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim();
}

/** Point each cited number at a page that contains it, and drop a number no cited page states. */
export function retargetCites(text: string, sources: readonly ClaimSource[]): string {
  if (!sources.length || !/\d/.test(text)) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.flatMap((sentence) => {
    const nums = significant(sentence);
    if (!nums.length) return [sentence];
    const cites = [...sentence.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    if (cites.length && cites.every((n) => covers(byNumber(sources, n), nums))) return [sentence];
    const page = sources.find((source) => covers(source, nums))?.n ?? bestPage(nums, sources, cites);
    if (!page) {
      const bare = stripNums(sentence.replace(/\s*\[\d+\]/g, ''), nums);
      return bare ? [bare] : [];
    }
    const missing = nums.filter((num) => !has(byNumber(sources, page), num));
    const bare = stripNums(sentence.replace(/\s*\[\d+\]/g, ''), missing);
    return bare ? [`${bare} [${page}]`] : [];
  }).join(' ');
}

export function priceFor(name: string, sources: readonly ClaimSource[], ceilings: readonly number[] = []): { price: string; n: number } | undefined {
  const head = (name.split(/[(\[]/)[0] ?? name);
  const words = head.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !PRICE_STOP.has(word)).slice(0, 2);
  if (!words.length || (words.length < 2 && words[0]!.length < 5)) return undefined;
  let found: { price: string; n: number } | undefined;
  for (const source of sources) {
    const low = source.text.toLowerCase();
    let at = -1;
    let from = 0;
    while (from < low.length) {
      const hit = low.indexOf(words[0]!, from);
      if (hit < 0) break;
      if (words.every((word) => low.slice(hit, hit + 48).includes(word))) {
        at = hit;
        break;
      }
      from = hit + 1;
    }
    if (at < 0) continue;
    const after = priced(source.text.slice(at, at + 120), ceilings);
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

function retargetNode(node: CardNode, sources: readonly ClaimSource[]): CardNode {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => retargetNode(child, sources)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => retargetNode(child, sources)) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft': {
      const text = retargetCites(node.text, sources);
      return text === node.text ? node : { ...node, text };
    }
    case 'heading': {
      const text = retargetCites(node.text, sources);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const caption = node.caption ? retargetCites(node.caption, sources) : node.caption;
      const nums = significant(node.value);
      const page = citeValue(node.value, sources, undefined);
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
        else if (value) {
          value = stripNums(value, valueNums);
          if (!value || !/\d/.test(value)) value = undefined;
          source = undefined;
        }
      }
      let sub = node.sub ? retargetCites(node.sub, sources) : node.sub;
      if (source && sub) {
        const missing = significant(sub).filter((num) => !has(byNumber(sources, source), num));
        if (missing.length) sub = stripNums(sub.replace(/\s*\[\d+\]/g, ''), missing);
      } else if (sub && !source && valueNums.length) {
        sub = stripNums(sub.replace(/\s*\[\d+\]/g, ''), significant(sub));
      }
      return value === node.value && sub === node.sub && source === node.source ? node : { ...node, value, sub, source };
    }
    case 'stat': {
      const nums = significant(node.value);
      const page = nums.length ? sources.find((item) => covers(item, nums)) : undefined;
      const value = nums.length && !page ? stripNums(node.value, nums) : node.value;
      const delta = node.delta ? retargetCites(node.delta, sources) : node.delta;
      return value === node.value && delta === node.delta ? node : { ...node, value, delta };
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
        const value = retargetCites(item.value, sources);
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

/** Move each number's citation onto a page that states it, then fill a missing product price from that page. */
export function bindClaims(node: CardNode, sources: readonly ClaimSource[], query: string): CardNode {
  if (!sources.length) return node;
  const aimed = retargetNode(node, sources);
  const tax = salesTax(query, sources);
  const taxed = tax ? applyTax(aimed, query, tax) : aimed;
  return shoppingAsk(query) ? fillPrices(taxed, sources, budgetAmounts(query)) : taxed;
}
