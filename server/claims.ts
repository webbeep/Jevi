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
const PRICE_STOP = new Set(['best', 'top', 'under', 'with', 'for', 'the', 'and', 'laptop', 'laptops', 'buy', 'cheap', 'budget', 'new', 'from', 'than', 'that', 'this']);

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

export function priceFor(name: string, sources: readonly ClaimSource[]): { price: string; n: number } | undefined {
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
    const after = source.text.slice(at, at + 90).match(MONEY);
    const before = source.text.slice(Math.max(0, at - 24), at).match(MONEY);
    const raw = after?.[0] ?? before?.[0];
    if (!raw) continue;
    found = { price: raw.replace(/\s/g, ''), n: source.n };
    if (after) break;
  }
  return found;
}

function hasPrice(text: string | undefined): boolean {
  return !!text && MONEY.test(text);
}

function citeValue(text: string, sources: readonly ClaimSource[], current: number | undefined): number | undefined {
  const nums = significant(text);
  if (!nums.length) return current;
  if (current && covers(byNumber(sources, current), nums)) return current;
  return sources.find((source) => covers(source, nums))?.n ?? (current && nums.some((num) => has(byNumber(sources, current), num)) ? current : undefined);
}

function fillPrices(node: CardNode, sources: readonly ClaimSource[]): CardNode {
  switch (node.type) {
    case 'list': {
      const items = node.items.map((item) => {
        if (hasPrice(item.meta) || hasPrice(item.text)) return item;
        const found = priceFor(item.text, sources);
        if (!found) return item;
        return { ...item, meta: found.price, source: item.source ?? found.n };
      });
      return items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'tile': {
      if (hasPrice(node.value) || hasPrice(node.sub) || hasPrice(node.label)) return node;
      const found = priceFor(node.value || node.label, sources);
      if (!found) return node;
      if (!node.value) return { ...node, value: found.price, source: node.source ?? found.n };
      return { ...node, sub: node.sub ? `${found.price} · ${node.sub}` : found.price, source: node.source ?? found.n };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => fillPrices(child, sources)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => fillPrices(child, sources)) })) };
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
      const page = citeValue(`${node.value} ${node.label} ${node.delta ?? ''}`, sources, undefined);
      if (!page) return node;
      const delta = node.delta && /\[\d+\]/.test(node.delta) ? retargetCites(node.delta, sources) : node.delta;
      return delta === node.delta ? node : { ...node, delta };
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
  return shoppingAsk(query) ? fillPrices(aimed, sources) : aimed;
}
