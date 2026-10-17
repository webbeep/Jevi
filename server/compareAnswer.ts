import type { CardNode } from '../shared/card';
import type { SearchResponse } from '../shared/types';
import { candidates } from './extract';
import { compareSides } from './patterns';

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

/** The longest word that actually names this side ("classes" in "past draft classes", not "past"). */
function sideKeys(side: string): string[] {
  const tokens = side.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(?:19|20)\d{2}$/.test(w) && !SMALL.has(w));
  if (!tokens.length) return [];
  const longest = Math.max(...tokens.map((t) => t.length));
  return tokens.filter((t) => t.length === longest);
}

function haystack(text: string): string {
  return text.toLowerCase();
}

/**
 * A product written as one word is the same side when the card splits it.
 * "glowband 4" is on the card that says "Glow Band 4". A different model number is not.
 */
function mentionsJoined(side: string, text: string): boolean {
  const target = side.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (target.length < 5) return false;
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length && j < i + 6; j++) {
      acc += words[j]!;
      if (acc === target) return true;
      if (acc.length > target.length) break;
    }
  }
  return false;
}

/** True when `text` uses this side's own name, not a generic word that merely sits next to it. */
export function mentionsSide(side: string, text: string): boolean {
  if (mentionsJoined(side, text)) return true;
  const keys = sideKeys(side);
  const hay = haystack(text);
  if (!keys.length) return hay.includes(side.toLowerCase());
  return keys.some((key) => {
    const stem = key.endsWith('s') && !key.endsWith('ss') ? key.slice(0, -1) : key;
    const has = (token: string) => new RegExp(`\\b${token}\\b`).test(hay);
    return has(key) || has(stem);
  });
}

function sideTitle(side: string): string {
  return side
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function shortSide(side: string): string {
  const titled = sideTitle(side);
  const words = titled.split(/\s+/);
  const dropped = words.filter((w, i) => !(i === 0 && /^(past|the|other)$/i.test(w)));
  return (dropped.length ? dropped : words).slice(0, 3).join(' ');
}

/**
 * A comparison title names the sides. The previous question, or a title that
 * never mentions them, is replaced. A title the model already aimed at the sides is kept.
 */
export function comparisonTitle(question: string, proposed: string): string {
  const sides = compareSides(question);
  if (sides.length < 2) return proposed;
  const named = sides.filter((side) => mentionsSide(side, proposed)).length;
  const same = proposed.trim().toLowerCase() === question.trim().toLowerCase();
  if (!same && (named >= 2 || (named === 1 && /\bvs\.?\b/i.test(proposed)))) return proposed;
  const title = sides.map(shortSide).join(' vs ');
  return title.length > 80 ? `${shortSide(sides[0]!)} vs ${sides.length - 1} others` : title;
}

function cardText(nodes: CardNode[]): string {
  const parts: string[] = [];
  const walk = (node: CardNode) => {
    if (node.type === 'section' && node.title) parts.push(node.title);
    if (node.type === 'heading' || node.type === 'text' || node.type === 'callout' || node.type === 'quote') parts.push(node.text);
    if (node.type === 'hero') parts.push(node.value, node.caption ?? '');
    if (node.type === 'stat') parts.push(node.label, node.value);
    if (node.type === 'tile') parts.push(node.label, node.value ?? '');
    if (node.type === 'list') for (const item of node.items) parts.push(item.text);
    if (node.type === 'table') {
      parts.push(...node.columns);
      for (const row of node.rows) parts.push(...row);
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
    if (node.type === 'accordion') for (const item of node.items) parts.push(item.title, item.text);
  };
  nodes.forEach(walk);
  return parts.filter(Boolean).join(' ');
}

/** A table or prose that names at least two of the sides. A biography of one of them does not. */
export function answersComparison(question: string, nodes: CardNode[]): boolean {
  const sides = compareSides(question);
  if (sides.length < 2) return true;
  const text = cardText(nodes);
  return sides.filter((side) => mentionsSide(side, text)).length >= 2;
}

function joinSides(sides: string[]): string {
  if (sides.length === 2) return `${sides[0]} and ${sides[1]}`;
  return `${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]}`;
}

/**
 * What the sources actually support for each side, in finished sentences.
 * A side with nothing gets a plain note instead of another subject's biography.
 */
export function comparisonNodes(question: string, search: SearchResponse): CardNode[] {
  const sides = compareSides(question);
  if (sides.length < 2) return [];
  const rows = candidates(search);
  const used = new Set<string>();
  const shared = rows.find((row) => sides.filter((side) => mentionsSide(side, row.text)).length >= 2);
  if (shared) used.add(shared.text);
  const covered = shared ? sides.filter((side) => mentionsSide(side, shared.text)) : [];
  const sections: CardNode[] = [];
  for (const side of sides) {
    const hit = rows.find((row) => !used.has(row.text) && mentionsSide(side, row.text));
    const title = sideTitle(side);
    if (hit) {
      used.add(hit.text);
      sections.push({ type: 'section', title, children: [{ type: 'text', text: hit.text }] });
      continue;
    }
    if (covered.includes(side)) continue;
    sections.push({ type: 'callout', tone: 'muted', title, text: `These sources don't cover ${side}.` });
  }
  const lead: CardNode = shared
    ? { type: 'text', text: shared.text, size: 'lg' }
    : { type: 'text', text: `Comparing ${joinSides(sides)}.`, size: 'lg' };
  return [lead, ...sections];
}

/**
 * When a comparison card never names two sides, replace the body with what the
 * sources say about each side. Extra biography nodes are blanked out of the body.
 */
export function comparisonRepair(question: string, search: SearchResponse, nodes: Map<number, CardNode>): { index: number; node: CardNode }[] | undefined {
  const body = [...nodes.entries()].filter(([, node]) => node.type !== 'actions' && node.type !== 'citations' && node.type !== 'ticker');
  if (compareSides(question).length < 2) return undefined;
  if (body.length && answersComparison(question, body.map(([, node]) => node))) return undefined;
  const built = comparisonNodes(question, search);
  if (!built.length) return undefined;
  const indexes = body.map(([index]) => index).sort((a, b) => a - b);
  const start = indexes[0] ?? 0;
  const patches: { index: number; node: CardNode }[] = [{ index: start, node: { type: 'stack', gap: 'md', children: built } }];
  for (const index of indexes.slice(1)) patches.push({ index, node: { type: 'citations', refs: [] } });
  return patches;
}

const STOP_NAME = new Set(['the', 'and', 'with', 'for', 'vs', 'versus']);
const MONEY = /(?:\$|€|£|¥)\s?[\d,]+(?:\.\d{2})?/;
const NOT_STATED = /\bnot stated\b/i;

export interface ShownProduct {
  name: string;
  price?: string;
  imageSrc?: string;
  rows: { factor: string; value: string }[];
}

function nameParts(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOP_NAME.has(word));
}

/** The same product, not a sibling model. "Edge" is not "Air". A shared number has to agree. */
export function sameProduct(a: string, b: string): boolean {
  const compact = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const leftCompact = compact(a);
  const rightCompact = compact(b);
  if (leftCompact.length >= 5 && leftCompact === rightCompact) return true;
  const left = nameParts(a);
  const right = nameParts(b);
  if (!left.length || !right.length) return false;
  const numbers = (parts: string[]) => parts.filter((word) => /^\d+$/.test(word));
  const leftNumbers = numbers(left);
  const rightNumbers = numbers(right);
  if (leftNumbers.length && rightNumbers.length && !leftNumbers.some((n) => rightNumbers.includes(n))) return false;
  const strong = (parts: string[]) => parts.filter((word) => word.length >= 4);
  const leftStrong = strong(left);
  const rightStrong = strong(right);
  if (leftStrong.length && rightStrong.length) {
    const [shorter, longer] = leftStrong.length <= rightStrong.length ? [leftStrong, rightStrong] : [rightStrong, leftStrong];
    if (!shorter.every((word) => longer.includes(word))) return false;
  } else if (!left.some((word) => right.includes(word))) {
    return false;
  }
  const weak = (parts: string[]) => parts.filter((word) => word.length < 4 && !/^\d+$/.test(word));
  const leftWeak = weak(left);
  const rightWeak = weak(right);
  if (leftWeak.length && rightWeak.length && !leftWeak.some((word) => rightWeak.includes(word))) return false;
  if ((leftWeak.length > 0) !== (rightWeak.length > 0)) return false;
  return leftStrong.length > 0 || leftNumbers.length > 0;
}

function money(value: string | undefined): string | undefined {
  return value?.match(MONEY)?.[0];
}

/** Prices, pictures, and filled rows already shown for each product. */
export function productsOnCard(nodes: readonly CardNode[], images: readonly { thumb: string }[] = []): ShownProduct[] {
  const out: ShownProduct[] = [];
  const find = (name: string) => out.find((product) => sameProduct(product.name, name));
  const take = (name: string): ShownProduct => {
    const have = find(name);
    if (have) return have;
    const next: ShownProduct = { name, rows: [] };
    out.push(next);
    return next;
  };
  const picture = (src?: string, ref?: number) => src || (ref !== undefined ? images[ref]?.thumb : undefined);
  const walk = (node: CardNode) => {
    if (node.type === 'tile') {
      const product = take(node.label);
      const price = money(node.value);
      if (price && !product.price) product.price = price;
      const src = picture(node.imageSrc, node.imageRef);
      if (src && !product.imageSrc) product.imageSrc = src;
    }
    if (node.type === 'table' && node.columns.length >= 2) {
      node.columns.slice(1).forEach((name, column) => {
        const product = take(name);
        for (const row of node.rows) {
          const factor = (row[0] ?? '').trim();
          const value = (row[column + 1] ?? '').trim();
          if (!factor || !value || NOT_STATED.test(value)) continue;
          if (/^price$/i.test(factor) && !product.price) product.price = money(value) ?? value;
          if (!product.rows.some((have) => have.factor.toLowerCase() === factor.toLowerCase())) product.rows.push({ factor, value });
        }
      });
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function withPrice(value: string, price: string): string {
  return MONEY.test(value) ? value.replace(MONEY, price) : price;
}

/**
 * A follow-up that adds a product keeps the price and picture already shown for a product
 * that is still in the comparison. A different model's number does not replace that price.
 * "Not stated" is filled from the row the earlier card already had.
 */
export function keepComparedProducts(prior: readonly CardNode[], nodes: Map<number, CardNode>, question: string, images: readonly { thumb: string }[] = []): { index: number; node: CardNode }[] | undefined {
  const kept = productsOnCard(prior, images);
  if (!kept.length || compareSides(question).length < 2) return undefined;
  const patches: { index: number; node: CardNode }[] = [];
  const visit = (node: CardNode): CardNode => {
    if (node.type === 'tile') {
      const product = kept.find((item) => sameProduct(item.name, node.label));
      if (!product) return node;
      let next = node;
      if (product.price && money(next.value) !== product.price) next = { ...next, value: money(next.value) ? withPrice(next.value ?? '', product.price) : product.price };
      if (product.imageSrc) next = { ...next, imageSrc: product.imageSrc, imageRef: undefined, imageQuery: undefined };
      return next;
    }
    if (node.type === 'table' && node.columns.length >= 2) {
      const rows = node.rows.map((row) => {
        const factor = (row[0] ?? '').trim();
        return row.map((cell, column) => {
          if (column === 0) return cell;
          const product = kept.find((item) => sameProduct(item.name, node.columns[column] ?? ''));
          if (!product) return cell;
          if (/^price$/i.test(factor)) {
            const price = money(cell);
            if (product.price && price && price !== product.price) return withPrice(cell, product.price);
            if (product.price && (!cell.trim() || NOT_STATED.test(cell))) return product.price;
          }
          if (NOT_STATED.test(cell)) {
            const earlier = product.rows.find((item) => item.factor.toLowerCase() === factor.toLowerCase());
            if (earlier) return earlier.value;
          }
          return cell;
        });
      });
      return { ...node, rows };
    }
    if ('children' in node && Array.isArray(node.children)) {
      const children = node.children.map(visit);
      return children.some((child, i) => child !== node.children[i]) ? { ...node, children } as CardNode : node;
    }
    if (node.type === 'tabs') {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map(visit) }));
      return { ...node, tabs };
    }
    return node;
  };
  for (const [index, node] of nodes) {
    if (node.type === 'actions' || node.type === 'citations' || node.type === 'ticker') continue;
    const next = visit(node);
    if (next !== node) patches.push({ index, node: next });
  }
  return patches.length ? patches : undefined;
}

/** A named side the card left out, filled from the search that was run for it. */
export function missingSideNode(question: string, nodes: readonly CardNode[], search: SearchResponse): CardNode | undefined {
  const present: string[] = [];
  const walk = (node: CardNode) => {
    if (node.type === 'tile') present.push(node.label);
    if (node.type === 'table') present.push(...node.columns.slice(1));
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
  };
  nodes.forEach(walk);
  const missing = compareSides(question).filter((side) => !present.some((label) => sameProduct(label, side)));
  if (!missing.length) return undefined;
  const children: CardNode[] = missing.slice(0, 3).map((side) => {
    const row = (search.results ?? []).find((item) => mentionsSide(side, `${item.title ?? ''} ${item.snippet ?? ''}`));
    const price = `${row?.title ?? ''} ${row?.snippet ?? ''}`.match(MONEY)?.[0];
    return { type: 'tile', label: sideTitle(side), ...(price ? { value: price } : {}) };
  });
  const cols: 2 | 3 = children.length >= 3 ? 3 : 2;
  return { type: 'grid', cols, children };
}
