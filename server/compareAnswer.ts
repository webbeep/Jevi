import type { CardNode } from '../shared/card';
import { cleanSideName } from '../shared/objects';
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

/** A shorter name the card uses ("Edge") still names that side. */
function sideWord(side: string, text: string): boolean {
  const hay = haystack(text);
  return side.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length >= 4 && new RegExp(`\\b${word}\\b`).test(hay));
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

const BRAND_SKIP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'best', 'top', 'new', 'vs', 'versus', 'review', 'reviews', 'compare', 'comparison']);

/**
 * Names to search for one product: the words they typed, a spaced split the sources use
 * ("glowband" beside "Glow Band"), and a brand sitting in front of that split.
 */
export function nameForms(side: string, corpus: string): string[] {
  const compact = side.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const forms: string[] = [];
  const add = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length < 2 || forms.some((have) => have.toLowerCase() === text.toLowerCase())) return;
    forms.push(text);
  };
  add(side);
  if (compact.length < 4) return forms;
  const words = corpus.match(/[A-Za-z0-9]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length && j < i + 4; j++) {
      acc += words[j]!.toLowerCase();
      if (acc.length > compact.length) break;
      if (acc !== compact || j === i) continue;
      const phrase = words.slice(i, j + 1).join(' ');
      add(phrase);
      const prev = words[i - 1];
      if (prev && /^[A-Z]/.test(prev) && prev.length >= 3 && !BRAND_SKIP.has(prev.toLowerCase())) add(`${prev} ${phrase}`);
      break;
    }
  }
  return forms;
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
const QUESTION_WORD = /\b(?:what|how|why|when|where|who|which|add|include)\b/i;

export function comparisonTitle(question: string, proposed: string): string {
  const sides = compareSides(question).map((side) => cleanSideName(side));
  if (sides.length < 2) return proposed;
  const title = sides.map(shortSide).join(' vs ');
  const bounded = title.length > 80 ? `${shortSide(sides[0]!)} vs ${sides.length - 1} others` : title;
  if (!sides.some((side) => QUESTION_WORD.test(side)) && QUESTION_WORD.test(proposed)) return bounded;
  const named = sides.filter((side) => mentionsSide(side, proposed)).length;
  const same = proposed.trim().toLowerCase() === question.trim().toLowerCase();
  if (!same && (named >= 2 || (named === 1 && /\bvs\.?\b/i.test(proposed)))) return proposed;
  return bounded;
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

/** Both sides have a tile or a table column. A verdict sentence that names them is not this. */
export function showsComparison(question: string, nodes: CardNode[]): boolean {
  const sides = compareSides(question);
  if (sides.length < 2) return true;
  const covered = new Set<string>();
  const note = (label: string) => {
    for (const side of sides) if (mentionsSide(side, label)) covered.add(side);
  };
  const walk = (node: CardNode) => {
    if (node.type === 'tile') note(node.label);
    if (node.type === 'section' && node.title) note(node.title);
    if (node.type === 'table') for (const column of node.columns) note(column);
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
  };
  nodes.forEach(walk);
  return covered.size >= Math.min(2, sides.length);
}

function joinSides(sides: string[]): string {
  if (sides.length === 2) return `${sides[0]} and ${sides[1]}`;
  return `${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]}`;
}

/**
 * What the sources actually support for each side, in finished sentences.
 * A side with nothing gets a plain note instead of another subject's biography.
 */
const STICKER = /(?:\$|€|£|¥)\s?\d{1,4}(?:,\d{3})*(?:\.\d{2})?/g;
const BLANK_CELL = /^[\s—–\-−~]*$/;

function labelKeys(label: string): string[] {
  return label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5).map((word) => word.slice(0, 5));
}

function mentionsLabel(label: string, sentence: string): boolean {
  const keys = labelKeys(label);
  if (!keys.length) return false;
  const words = sentence.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return keys.some((key) => words.some((word) => word.startsWith(key)));
}

const MEASURE = /\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*[x×]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?)*(?:\s*[-–]?\s*(?:inch(?:es)?|["″]|mm|cm|kg|oz|mah|nits?|atm|px|hours?|days?|shots?|frames?|grams?|g\b))/i;

/** The number and unit in a sentence ("1.34-inch", "17.7 g", "16 days"). A bare year is not a spec. */
function measuredPhrase(sentence: string): string | undefined {
  const match = sentence.match(MEASURE);
  if (!match) return undefined;
  const phrase = match[0].replace(/\s+/g, ' ').trim();
  return measureNumbers(phrase).length ? phrase : undefined;
}

/** A spec cell with no measurement takes the number the source states for that row. */
function specFromSources(label: string, side: string, search: SearchResponse): string | undefined {
  if (!labelKeys(label).length) return undefined;
  for (const result of search.results) {
    const blob = `${result.title ?? ''}. ${result.snippet ?? ''} ${result.content ?? ''}`;
    if (!mentionsSide(side, `${result.title ?? ''} ${result.snippet ?? ''}`)) continue;
    for (const sentence of blob.split(/(?<=[.!?])\s+/)) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (clean.length < 8 || clean.length > 400) continue;
      for (const clause of clean.split(/\s*(?:,|;|\band\b|\bwith\b)\s*/i)) {
        if (!mentionsLabel(label, clause)) continue;
        const phrase = measuredPhrase(clause);
        if (phrase) return phrase;
      }
    }
  }
  return undefined;
}
const RELATIVE_PRICE = /\b(?:cheaper|cost(?:s|ing)? more|more expensive|less expensive|saving|saves|discount|between|than)\b|(?:\$|€|£|¥)\s?\d[\d,]*(?:\.\d{2})?\s*[–-]\s*(?:\$|€|£|¥)?\s?\d/i;
const NO_PRICE = /\bno price stated\b|\bprice (?:is )?not stated\b|\bno specs or price\b/i;
const DENIES_PRICE = /\b(?:no|not|n't|without)\b(?:\s+\w+){0,8}\s+price\b/i;

/** A price from a clause that names this side. Another side's price is not reused. */
function statedPrice(side: string, search: SearchResponse, blocked: readonly string[]): string | undefined {
  const taken = new Set(blocked.map((price) => price.replace(/\s/g, '')));
  const accept = (amount: string | undefined) => {
    if (!amount) return undefined;
    const price = amount.replace(/\s/g, '');
    return taken.has(price) ? undefined : price;
  };
  const direct = accept(stickerPrice(side, search));
  if (direct) return direct;
  const marks = side.toLowerCase().split(/[^a-z0-9]+/).filter((word) => /\d/.test(word));
  if (!marks.length) return undefined;
  for (const result of search.results) {
    const blob = `${result.title ?? ''}. ${result.snippet ?? ''} ${result.content ?? ''}`;
    if (!marks.some((mark) => blob.toLowerCase().includes(mark))) continue;
    for (const sentence of blob.split(/(?<=[.!?])\s+/)) {
      for (const clause of sentence.split(/\s*(?:;|\band\b|\bwith\b|,(?!\d))\s*/i)) {
        if (!marks.some((mark) => clause.toLowerCase().includes(mark)) || RELATIVE_PRICE.test(clause)) continue;
        const amounts = [...clause.matchAll(new RegExp(STICKER.source, 'g'))].map((match) => match[0]);
        if (amounts.length !== 1) continue;
        const price = accept(amounts[0]);
        if (price) return price;
      }
    }
  }
  return undefined;
}

/** One amount the source states for this product. A range or a "cheaper" line is not that price. */
export function stickerPrice(side: string, search: SearchResponse): string | undefined {
  for (const result of search.results) {
    const blob = `${result.title}. ${result.snippet ?? ''} ${result.content ?? ''}`;
    if (!mentionsSide(side, blob)) continue;
    for (const sentence of blob.split(/(?<=[.!?])\s+/)) {
      if (!mentionsSide(side, sentence) || RELATIVE_PRICE.test(sentence)) continue;
      const amounts = [...sentence.matchAll(STICKER)].map((match) => match[0].replace(/\s/g, ''));
      if (amounts.length === 1) return amounts[0];
    }
  }
  return undefined;
}

function moneyIn(text: string): string | undefined {
  if (RELATIVE_PRICE.test(text)) return undefined;
  const amounts = [...text.matchAll(STICKER)].map((match) => match[0].replace(/\s/g, ''));
  return amounts.length === 1 ? amounts[0] : undefined;
}

function priceForSide(side: string, rows: { text: string }[]): string | undefined {
  for (const row of rows) {
    if (!mentionsSide(side, row.text)) continue;
    const price = moneyIn(row.text);
    if (price) return price;
  }
  return undefined;
}

const PROMO = /\b(?:promo(?:tion)?|giveaway|airdrop|rewards?)\b/i;
const ROMAN = /^(?:ii|iii|iv|vi|vii|viii|ix)$/;

/** Model marks that separate this product from the one next to it ("X-9" and "II", not the brand alone). */
function productMarks(side: string): string[] {
  return side.toLowerCase().split(/[^a-z0-9]+/).filter((word) => /\d/.test(word) || ROMAN.test(word) || (word.length >= 2 && word.length <= 3));
}

function hasMark(mark: string, title: string): boolean {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.includes(mark)) return true;
  return mark.length >= 3 && words.join('').includes(mark);
}

/**
 * The page is about this product. The brand alone is not enough when the name has a model
 * ("X-9 II" is not "X-9"). A title that carries the model still counts when it omits the brand.
 */
function pageNamesProduct(side: string, title: string): boolean {
  const marks = productMarks(side);
  if (marks.length && !marks.every((mark) => hasMark(mark, title))) return false;
  if (mentionsSide(side, title) || mentionsJoined(side, title)) return true;
  const words = side.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const compact = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('');
  if (words.join('').length >= 5 && compact.includes(words.join(''))) return true;
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length && j < i + 3; j++) {
      acc += words[j]!;
      if (j > i && acc.length >= 3 && /\d/.test(acc) && compact.includes(acc)) return true;
    }
  }
  return false;
}

/** A picture of this product, from a page about this product. A promo or a versus roundup is not that picture. */
export function acceptProductPhoto(side: string, title: string, extra = ''): boolean {
  const page = title.replace(/\s+/g, ' ').trim();
  if (!page || /\b(?:vs\.?|versus)\b/i.test(page)) return false;
  const blob = `${page} ${extra}`;
  if (PROMO.test(blob) && !PROMO.test(side)) return false;
  return pageNamesProduct(side, page);
}

function imageForSide(side: string, images: SearchResponse['images']): string | undefined {
  const hit = images.find((image) => acceptProductPhoto(side, `${image.title} ${image.source}`));
  return hit?.thumb || undefined;
}

/**
 * Each side keeps a photo from a page about that side. A photo already recorded for a
 * different side is taken off. A price already written on the tile stays.
 */
export function placeSidePhotos(question: string, nodes: Map<number, CardNode>, images: SearchResponse['images']): { index: number; node: CardNode }[] | undefined {
  const sides = compareSides(question).map((side) => cleanSideName(side));
  if (sides.length < 2 || !images?.length) return undefined;
  const owner = new Map<string, string>();
  for (const image of images) {
    if (!image.thumb || owner.has(image.thumb)) continue;
    const side = sides.find((item) => acceptProductPhoto(item, `${image.title} ${image.source}`));
    if (side) owner.set(image.thumb, side);
  }
  if (!owner.size) return undefined;
  const photoFor = (side: string) => images.find((image) => image.thumb && owner.get(image.thumb) === side)?.thumb;
  const patches: { index: number; node: CardNode }[] = [];
  const visit = (node: CardNode): CardNode => {
    if (node.type === 'tile') {
      const side = sides.find((item) => mentionsSide(item, node.label) || pageNamesProduct(item, node.label));
      if (!side) return node;
      const own = photoFor(side);
      const borrowed = !!node.imageSrc && owner.has(node.imageSrc) && owner.get(node.imageSrc) !== side;
      if (borrowed && !own) return { ...node, imageSrc: undefined, imageRef: undefined, imageQuery: undefined };
      const imageSrc = borrowed ? own : node.imageSrc || own;
      if (!imageSrc || imageSrc === node.imageSrc) return node;
      return { ...node, imageSrc, imageRef: undefined, imageQuery: undefined };
    }
    if ('children' in node && Array.isArray(node.children)) {
      const children = node.children.map(visit);
      return children.some((child, index) => child !== node.children[index]) ? { ...node, children } as CardNode : node;
    }
    if (node.type === 'tabs') {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map(visit) }));
      return tabs.some((tab, index) => tab.children.some((child, childIndex) => child !== node.tabs[index]?.children[childIndex]))
        ? { ...node, tabs }
        : node;
    }
    return node;
  };
  for (const [index, node] of nodes) {
    const next = visit(node);
    if (next !== node) patches.push({ index, node: next });
  }
  return patches.length ? patches : undefined;
}

export function comparisonNodes(question: string, search: SearchResponse): CardNode[] {
  const sides = compareSides(question);
  if (sides.length < 2) return [];
  const rows = [
    ...candidates(search),
    ...search.results.map((result) => ({ text: `${result.title} ${result.snippet ?? ''} ${result.content ?? ''}`.replace(/\s+/g, ' ').trim() })),
  ];
  const used = new Set<string>();
  const shared = rows.find((row) => sides.filter((side) => mentionsSide(side, row.text)).length >= 2);
  if (shared) used.add(shared.text);
  const covered = shared ? sides.filter((side) => mentionsSide(side, shared.text)) : [];
  const tiles: CardNode[] = sides.map((side) => {
    const title = sideTitle(side);
    const price = priceForSide(side, rows);
    const image = imageForSide(side, search.images ?? []);
    return {
      type: 'tile',
      label: title,
      value: price,
      imageQuery: title,
      imageSrc: image,
    };
  });
  const priced = tiles.filter((tile) => tile.type === 'tile' && tile.value);
  const table: CardNode | undefined = priced.length
    ? {
        type: 'table',
        columns: ['', ...sides.map(sideTitle)],
        rows: [['Price', ...sides.map((side) => priceForSide(side, rows) ?? '')]],
      }
    : undefined;
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
  const grid: CardNode = { type: 'grid', cols: Math.min(sides.length, 3) as 2 | 3, children: tiles };
  return [grid, ...(table ? [table] : []), lead, ...sections];
}

function shownPrices(nodes: readonly CardNode[], sides: string[]): Map<string, string> {
  const prices = new Map<string, string>();
  const note = (label: string, text: string) => {
    const amount = text.match(STICKER)?.[0]?.replace(/\s/g, '');
    if (!amount) return;
    const side = sides.find((item) => mentionsSide(item, label) || mentionsSide(item, text));
    if (side && !prices.has(side)) prices.set(side, amount);
  };
  const walk = (node: CardNode) => {
    if (node.type === 'tile' && node.value) note(node.label, node.value);
    if (node.type === 'table') {
      for (const row of node.rows) {
        if (!priceRow(row[0] ?? '')) continue;
        row.forEach((cell, index) => note(node.columns[index] ?? '', cell));
      }
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
  };
  nodes.forEach(walk);
  return prices;
}

function groundCompareNode(node: CardNode, sides: string[], search: SearchResponse, shown: ReadonlyMap<string, string>): CardNode {
  if (node.type === 'text' || node.type === 'callout' || node.type === 'heading') {
    const text = node.text.split(/(?<=[.!?])\s+/).map((sentence) => {
      const side = sides.find((item) => mentionsSide(item, sentence) || sideWord(item, sentence));
      const price = side ? shown.get(side) || stickerPrice(side, search) : undefined;
      if (price && (NO_PRICE.test(sentence) || DENIES_PRICE.test(sentence))) return '';
      if (!RELATIVE_PRICE.test(sentence)) return sentence;
      if (!price) return sentence.replace(RELATIVE_PRICE, '').replace(/\s{2,}/g, ' ').trim();
      return sentence.replace(RELATIVE_PRICE, price);
    }).filter(Boolean).join(' ');
    return text === node.text ? node : { ...node, text };
  }
  if (node.type === 'tile') {
    const side = sides.find((item) => mentionsSide(item, node.label));
    if (!side) return node;
    const blocked = [...shown.entries()].filter(([name]) => name !== side).map(([, price]) => price);
    const price = statedPrice(side, search, blocked);
    const image = imageForSide(side, search.images ?? []);
    const missing = !node.value || NOT_STATED.test(node.value) || /not in sources|no specs/i.test(node.value);
    const relative = !!node.value && (RELATIVE_PRICE.test(node.value) || !moneyIn(node.value));
    const value = price && (missing || relative) ? price : node.value;
    const imageSrc = node.imageSrc || image;
    if (value === node.value && imageSrc === node.imageSrc) return node;
    return { ...node, value, imageSrc, imageQuery: node.imageQuery ?? sideTitle(side) };
  }
  if (node.type === 'table') {
    const rows = node.rows.map((row) => row.map((cell, index) => {
      const side = sides.find((item) => mentionsSide(item, node.columns[index] ?? ''));
      if (!side || moneyIn(cell)) return cell;
      if (priceRow(row[0] ?? '') || RELATIVE_PRICE.test(cell)) {
        const blocked = [...shown.entries()].filter(([name]) => name !== side).map(([, price]) => price);
        const found = statedPrice(side, search, blocked);
        if (found) return found;
        return BLANK_CELL.test(cell) || NOT_STATED.test(cell) ? cell : '';
      }
      if (hasMeasure(cell)) return cell;
      return specFromSources(row[0] ?? '', side, search) ?? cell;
    }));
    const confirmed = rows.map((row, rowIndex) => row.map((cell, index) => {
      if (index === 0 || !hasMeasure(cell)) return cell;
      const factor = row[0] ?? '';
      const side = sides.find((item) => mentionsSide(item, node.columns[index] ?? ''));
      if (!side || specFromSources(factor, side, search)) return cell;
      const nums = measureNumbers(cell);
      const copied = rows.slice(0, rowIndex).some((earlier) => nums.every((num) => measureNumbers(earlier[index] ?? '').includes(num)) && labelKeys(factor).some((key) => labelKeys(earlier[0] ?? '').includes(key)));
      return copied ? '' : cell;
    }));
    if (confirmed.every((row, index) => row.every((cell, cellIndex) => cell === node.rows[index]?.[cellIndex]))) return node;
    return { ...node, rows: confirmed };
  }
  if (node.type === 'tabs') {
    return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => groundCompareNode(child, sides, search, shown)) })) };
  }
  if ('children' in node && Array.isArray(node.children)) {
    const children = node.children.map((child) => groundCompareNode(child, sides, search, shown));
    if (children.every((child, index) => child === node.children[index])) return node;
    return { ...node, children } as CardNode;
  }
  return node;
}

const OFFER_WORD = /\b(?:carrier|verizon|at&t|t-mobile|tmobile|sprint|monthly|per month|a month|\/mo\b|with service|on contract|installment|with a plan|cellular plan|financing)\b/i;

function moneyAmounts(text: string): string[] {
  return [...text.matchAll(STICKER)].map((match) => match[0].replace(/\s/g, ''));
}

function sameMoney(a: string, b: string): boolean {
  const value = (raw: string) => Number(raw.replace(/[^0-9.]/g, ''));
  return Math.abs(value(a) - value(b)) < 0.001;
}

/** A carrier plan, a monthly bill, or a contract is a different offer from the product's own price. */
function offerName(text: string): string | undefined {
  const carrier = text.match(/\b(Verizon|AT&T|T-Mobile|Sprint)\b/i);
  if (carrier) {
    const word = carrier[1]!;
    const label = /[A-Z]/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    return `${label} price`;
  }
  if (/\b(?:per month|\/mo|monthly|a month|installment)\b/i.test(text)) return 'Monthly price';
  if (OFFER_WORD.test(text)) return 'Carrier price';
  return undefined;
}

function priceRow(label: string): boolean {
  return label.length < 48 && /\b(?:price|msrp|cost|retail)\b/i.test(label);
}

/**
 * Two amounts for one product have to be the same amount where the card presents
 * them as its price. A second amount stays only with a label that names the other offer.
 */
function agreeSidePrices(nodes: CardNode[], sides: string[]): CardNode[] {
  const copy = nodes.map((node) => structuredClone(node));
  const lead = new Map<string, string>();
  const note = (side: string, text: string) => {
    const amount = moneyAmounts(text)[0];
    if (!amount || lead.has(side) || offerName(text)) return;
    lead.set(side, amount);
  };
  const collect = (node: CardNode) => {
    if (node.type === 'tile') {
      const side = sides.find((item) => mentionsSide(item, node.label));
      if (side && node.value) note(side, `${node.value} ${node.sub ?? ''}`);
    }
    if (node.type === 'table') {
      for (const row of node.rows) {
        if (!priceRow(row[0] ?? '')) continue;
        row.forEach((cell, index) => {
          const side = sides.find((item) => mentionsSide(item, node.columns[index] ?? ''));
          if (side) note(side, cell);
        });
      }
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(collect);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(collect);
  };
  copy.forEach(collect);
  if (!lead.size) return nodes;
  const rewrite = (node: CardNode) => {
    if (node.type === 'tile') {
      const side = sides.find((item) => mentionsSide(item, node.label));
      const headline = side ? lead.get(side) : undefined;
      const amount = node.value ? moneyAmounts(node.value)[0] : undefined;
      if (!headline || !amount || sameMoney(amount, headline)) return;
      const offer = offerName(`${node.value ?? ''} ${node.sub ?? ''}`);
      node.value = headline;
      if (offer && !(node.sub && node.sub.includes(amount))) node.sub = node.sub ? `${offer} ${amount}. ${node.sub}` : `${offer} ${amount}`;
    }
    if (node.type === 'table') {
      const extras = new Map<string, string[]>();
      for (const row of node.rows) {
        if (!priceRow(row[0] ?? '')) continue;
        row.forEach((cell, index) => {
          const side = sides.find((item) => mentionsSide(item, node.columns[index] ?? ''));
          const headline = side ? lead.get(side) : undefined;
          const amount = moneyAmounts(cell)[0];
          if (!headline || !amount || sameMoney(amount, headline)) return;
          const offer = offerName(cell);
          row[index] = headline;
          if (!offer) return;
          const cells = extras.get(offer) ?? node.columns.map((_, at) => (at === 0 ? offer : ''));
          cells[index] = amount;
          extras.set(offer, cells);
        });
      }
      for (const cells of extras.values()) node.rows.push(cells);
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(rewrite);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(rewrite);
  };
  copy.forEach(rewrite);
  return JSON.stringify(copy) === JSON.stringify(nodes) ? nodes : copy;
}

function groundCompared(question: string, search: SearchResponse, body: [number, CardNode][]): { index: number; node: CardNode }[] | undefined {
  const sides = compareSides(question);
  const shown = shownPrices(body.map(([, node]) => node), sides);
  const grounded = body.map(([, node]) => groundCompareNode(node, sides, search, shown));
  const agreed = agreeSidePrices(grounded, sides);
  const patches: { index: number; node: CardNode }[] = [];
  agreed.forEach((node, at) => {
    if (node !== body[at]![1]) patches.push({ index: body[at]![0], node });
  });
  return patches.length ? patches : undefined;
}

/**
 * A head-to-head table names each side in a row, not only in a column.
 * That breakdown already answers the comparison, so it is not rebuilt.
 */
export function breakdownStays(question: string, nodes: readonly CardNode[]): boolean {
  const sides = compareSides(question);
  if (sides.length < 2) return false;
  const named = new Set<string>();
  let measured = false;
  const note = (label: string) => {
    for (const side of sides) if (mentionsSide(side, label)) named.add(side);
  };
  const see = (node: CardNode) => {
    if (node.type === 'table') {
      node.columns.forEach(note);
      for (const row of node.rows) {
        note(row[0] ?? '');
        if (row.slice(1).some((cell) => measureNumbers(cell).length)) measured = true;
      }
    }
    if (node.type === 'tile') {
      note(node.label);
      if (measureNumbers(`${node.value ?? ''} ${node.sub ?? ''}`).length) measured = true;
    }
    if (node.type === 'stat') {
      note(node.label);
      if (measureNumbers(node.value).length) measured = true;
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(see);
    if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(see));
  };
  nodes.forEach(see);
  return named.size >= 2 && measured;
}

/**
 * When a comparison card never names two sides, replace the body with what the
 * sources say about each side. Extra biography nodes are blanked out of the body.
 * A breakdown that already names each side and states a number stays as it is.
 */
export function comparisonRepair(question: string, search: SearchResponse, nodes: Map<number, CardNode>): { index: number; node: CardNode }[] | undefined {
  const body = [...nodes.entries()].filter(([, node]) => node.type !== 'actions' && node.type !== 'citations' && node.type !== 'ticker');
  if (compareSides(question).length < 2) return undefined;
  if (body.length && showsComparison(question, body.map(([, node]) => node))) return groundCompared(question, search, body);
  if (body.length && breakdownStays(question, body.map(([, node]) => node))) return undefined;
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
      const product = take(cleanSideName(node.label));
      const price = money(node.value);
      if (price && !product.price) product.price = price;
      const src = picture(node.imageSrc, node.imageRef);
      if (src && !product.imageSrc) product.imageSrc = src;
    }
    if (node.type === 'table' && node.rows.some((row) => row.length >= 2)) {
      const columns = shownColumns(node.columns, node.rows);
      columns.forEach((name, index) => {
        if (index === 0 || !name.trim()) return;
        const product = take(cleanSideName(name));
        for (const row of node.rows) {
          const factor = (row[0] ?? '').trim();
          const value = (row[index] ?? '').trim();
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
 * The header the table actually draws. A row that is wider than the header list
 * is a factor plus one cell per product, so the product names sit on the right.
 */
function shownColumns(columns: readonly string[], rows: readonly string[][]): string[] {
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  return [...Array(Math.max(0, width - columns.length)).fill(''), ...columns];
}

/** Numbers that are a spec. A bracket citation is not one. */
function measureNumbers(text: string): string[] {
  const bare = text.replace(/\s*\[(?:\d+\s*,\s*)*\d+\]/g, ' ');
  return [...bare.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

/** A measured spec has a number. A citation like [1] and a slogan ("vibrant", "lightweight") do not. */
function hasMeasure(text: string): boolean {
  return measureNumbers(text).length > 0;
}

/**
 * A follow-up that adds a product keeps the price and picture already shown for a product
 * that is still in the comparison. A different model's number does not replace that price.
 * A measured spec stays when the new cell is a slogan or a blank, and a dropped measured row comes back.
 */
export function keepComparedProducts(prior: readonly CardNode[], nodes: Map<number, CardNode>, question: string, images: readonly { thumb: string }[] = []): { index: number; node: CardNode }[] | undefined {
  const kept = productsOnCard(prior, images);
  if (!kept.length || compareSides(question).length < 2) return undefined;
  const patches: { index: number; node: CardNode }[] = [];
  const visit = (node: CardNode): CardNode => {
    if (node.type === 'tile') {
      const clean = cleanSideName(node.label);
      const product = kept.find((item) => sameProduct(item.name, clean));
      const label = clean === node.label.trim() ? node.label : (product?.name ?? clean);
      let next = label !== node.label ? { ...node, label } : node;
      if (!product) return next;
      if (product.price && money(next.value) !== product.price) next = { ...next, value: money(next.value) ? withPrice(next.value ?? '', product.price) : product.price };
      if (product.imageSrc) next = { ...next, imageSrc: product.imageSrc, imageRef: undefined, imageQuery: undefined };
      return next;
    }
    if (node.type === 'table' && node.rows.some((row) => row.length >= 2)) {
      const columns = shownColumns(node.columns, node.rows).map((name, index) => {
        if (index === 0 || !String(name).trim()) return name;
        const clean = cleanSideName(name);
        if (clean === String(name).trim()) return name;
        const product = kept.find((item) => sameProduct(item.name, clean));
        return product ? product.name : clean;
      });
      const rows = node.rows.map((row) => {
        const factor = (row[0] ?? '').trim();
        const padded = [...row, ...Array(Math.max(0, columns.length - row.length)).fill('')];
        return padded.map((cell, column) => {
          if (column === 0) return cell;
          const product = kept.find((item) => sameProduct(item.name, columns[column] ?? ''));
          if (!product) return cell;
          if (/^price$/i.test(factor)) {
            const price = money(cell);
            if (product.price && price && price !== product.price) return withPrice(cell, product.price);
            if (product.price && (!price || NOT_STATED.test(cell) || BLANK_CELL.test(cell))) return product.price;
          }
          const earlier = product.rows.find((item) => item.factor.toLowerCase() === factor.toLowerCase());
          if (earlier && (NOT_STATED.test(cell) || BLANK_CELL.test(cell) || (hasMeasure(earlier.value) && !hasMeasure(cell)))) return earlier.value;
          return cell;
        });
      });
      const present = new Set(rows.map((row) => (row[0] ?? '').trim().toLowerCase()).filter(Boolean));
      const priorFactors = new Set(kept.flatMap((product) => product.rows.map((row) => row.factor.toLowerCase())));
      const sharesFactor = [...present].some((factor) => priorFactors.has(factor));
      const measuredHere = rows.some((row) => row.slice(1).some((cell) => hasMeasure(cell)));
      const pending = new Map<string, string[]>();
      columns.forEach((name, column) => {
        if (column === 0 || !name.trim()) return;
        const product = kept.find((item) => sameProduct(item.name, name));
        if (!product) return;
        const shown = rows.map((row) => row[column] ?? '').join('\n');
        const shownNumbers = new Set(measureNumbers(shown));
        for (const earlier of product.rows) {
          const key = earlier.factor.toLowerCase();
          if (!hasMeasure(earlier.value) || present.has(key)) continue;
          const numbers = measureNumbers(earlier.value);
          if (numbers.length && numbers.every((n) => shownNumbers.has(n))) continue;
          const extra = pending.get(key) ?? columns.map((_, index) => (index === 0 ? earlier.factor : ''));
          if (!extra[column]) extra[column] = earlier.value;
          pending.set(key, extra);
        }
      });
      // A different breakdown already has its own numbers. The previous card's rows are not pasted back on.
      const nextRows = !sharesFactor && measuredHere ? rows : [...rows, ...pending.values()];
      const sameColumns = columns.length === node.columns.length && columns.every((name, index) => name === node.columns[index]);
      const sameRows = nextRows.length === node.rows.length && nextRows.every((row, index) => row.length === node.rows[index]?.length && row.every((cell, cellIndex) => cell === node.rows[index]?.[cellIndex]));
      if (sameColumns && sameRows) return node;
      return { ...node, columns, rows: nextRows };
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

const ASKED_STOP = new Set(['camera', 'cameras', 'product', 'products', 'model', 'models', 'these', 'those', 'which', 'about', 'their', 'please', 'would', 'could', 'should', 'compare', 'every', 'other', 'thing', 'things']);

function askedLabel(question: string): string | undefined {
  const word = question.toLowerCase().split(/[^a-z0-9]+/).find((item) => item.length >= 5 && !ASKED_STOP.has(item));
  if (!word) return undefined;
  return word[0]!.toUpperCase() + word.slice(1);
}

const FACT_DENIAL = /\b(?:not stated|not in (?:the |these )?sources|unavailable|none of the sources|no sources?|neither|don'?t state|do not state|does not state|doesn'?t state)\b|\bno\b[^.]{0,48}\b(?:rating|figure|spec)\b/i;
const BLANKET_DENIAL = /\b(?:neither|either|both|all of them|every one|none of the)\b/i;

interface ShownFact {
  label: string;
  filled: string[];
  empty: string[];
}

function shownFacts(nodes: Iterable<CardNode>): ShownFact[] {
  const facts = new Map<string, ShownFact>();
  const take = (label: string): ShownFact => {
    const key = label.toLowerCase();
    const have = facts.get(key);
    if (have) return have;
    const next = { label, filled: [], empty: [] };
    facts.set(key, next);
    return next;
  };
  const walk = (node: CardNode) => {
    if (node.type === 'table') {
      const columns = shownColumns(node.columns, node.rows);
      for (const row of node.rows) {
        const label = (row[0] ?? '').trim();
        if (!labelKeys(label).length) continue;
        const fact = take(label);
        columns.forEach((name, column) => {
          if (column === 0 || !String(name).trim()) return;
          const cell = row[column] ?? '';
          if (measureNumbers(cell).length) fact.filled.push(String(name));
          else fact.empty.push(String(name));
        });
      }
    }
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  for (const node of nodes) walk(node);
  return [...facts.values()].filter((fact) => fact.filled.length > 0);
}

/** A sentence that says the fact is missing, while a cell already states it. A line about only the empty side can stay. */
function deniesShown(sentence: string, facts: readonly ShownFact[]): boolean {
  const text = sentence.trim();
  if (!text || !FACT_DENIAL.test(text)) return false;
  for (const fact of facts) {
    if (!mentionsLabel(fact.label, text)) continue;
    const namesFilled = fact.filled.some((side) => mentionsSide(side, text) || sideWord(side, text));
    const namesEmpty = fact.empty.some((side) => mentionsSide(side, text) || sideWord(side, text));
    if (namesEmpty && !namesFilled && !BLANKET_DENIAL.test(text)) continue;
    return true;
  }
  return false;
}

function withoutDenial(node: CardNode, facts: readonly ShownFact[]): CardNode | undefined {
  if (node.type === 'callout' || node.type === 'text' || node.type === 'heading') {
    const text = node.text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence && !deniesShown(sentence, facts)).join(' ');
    if (node.type === 'callout') {
      const title = node.title && deniesShown(node.title, facts) ? undefined : node.title;
      if (!text && !title) return undefined;
      if (text === node.text && title === node.title) return node;
      return title ? { ...node, text, title } : { ...node, text, title: undefined };
    }
    if (!text) return undefined;
    return text === node.text ? node : { ...node, text };
  }
  if ('children' in node && Array.isArray(node.children)) {
    const children = node.children.map((child) => withoutDenial(child, facts)).filter((child): child is CardNode => !!child);
    if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) return node;
    if (!children.length) return undefined;
    return { ...node, children } as CardNode;
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => withoutDenial(child, facts)).filter((child): child is CardNode => !!child) }));
    if (tabs.every((tab, index) => tab.children.length === node.tabs[index]?.children.length && tab.children.every((child, childIndex) => child === node.tabs[index]?.children[childIndex]))) return node;
    return { ...node, tabs };
  }
  return node;
}

/** A cited measurement and a “not in the sources” line cannot both stand for the same fact. */
export function dropShownDenials(nodes: Map<number, CardNode>): { index: number; node: CardNode }[] | undefined {
  const facts = shownFacts(nodes.values());
  if (!facts.length) return undefined;
  const patches: { index: number; node: CardNode }[] = [];
  for (const [index, node] of nodes) {
    const next = withoutDenial(node, facts);
    if (next === node) continue;
    patches.push({ index, node: next ?? { type: 'stack', children: [] } });
  }
  return patches.length ? patches : undefined;
}

/** A follow-up that drops the pictures puts each side's own photo and price back. */
export function restoreSideTiles(prior: readonly CardNode[], nodes: Map<number, CardNode>, question: string): { index: number; node: CardNode }[] | undefined {
  const sides = compareSides(question).map((side) => cleanSideName(side));
  if (sides.length < 2) return undefined;
  let hasTile = false;
  const see = (node: CardNode) => {
    if (node.type === 'tile') hasTile = true;
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(see);
    if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(see));
  };
  for (const node of nodes.values()) see(node);
  if (hasTile) return undefined;
  const products = productsOnCard(prior);
  const tiles: CardNode[] = [];
  for (const side of sides) {
    const product = products.find((item) => sameProduct(item.name, side));
    if (!product || (!product.imageSrc && !product.price)) continue;
    tiles.push({ type: 'tile', label: product.name, value: product.price, imageSrc: product.imageSrc });
  }
  if (tiles.length < 2) return undefined;
  const cols = Math.min(tiles.length, 3) as 2 | 3;
  const grid: CardNode = { type: 'grid', cols, children: tiles };
  const first = [...nodes.entries()].find(([, node]) => node.type !== 'actions' && node.type !== 'citations' && node.type !== 'ticker');
  if (!first) return undefined;
  return [{ index: first[0], node: { type: 'stack', gap: 'md', children: [grid, first[1]] } }];
}

/** A follow-up that asks for one fact adds that row when a source states it for a side. */
export function appendAskedFact(question: string, sidesQuery: string, nodes: Map<number, CardNode>, search: SearchResponse): { index: number; node: CardNode }[] | undefined {
  const sides = compareSides(sidesQuery).map((side) => cleanSideName(side));
  const label = askedLabel(question);
  if (!label || sides.length < 2) return undefined;
  for (const [index, node] of nodes) {
    if (node.type !== 'table' || !node.rows.some((row) => row.length >= 2)) continue;
    if (node.rows.some((row) => mentionsLabel(label, row[0] ?? ''))) return undefined;
    const columns = shownColumns(node.columns, node.rows);
    const cells = columns.map((name, column) => {
      if (column === 0) return label;
      const side = sides.find((item) => mentionsSide(item, name));
      return side ? specFromSources(label, side, search) ?? '' : '';
    });
    if (!cells.slice(1).some((cell) => cell.trim())) continue;
    const rows = [
      ...node.rows.map((row) => [...row, ...Array(Math.max(0, columns.length - row.length)).fill('')]),
      cells,
    ];
    return [{ index, node: { ...node, columns, rows } }];
  }
  return undefined;
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
