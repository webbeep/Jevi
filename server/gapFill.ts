import type { CardNode } from '../shared/card';
import { GAP_MARK } from '../shared/gap';

const BLANK = /^[\s—–\-−~]*$/;
const NOT_STATED = /\bnot stated\b/i;
const CITE = /\[\d+\]/;
const MEASURE = /\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*[x×]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?)*(?:\s*[-–]?\s*(?:inch(?:es)?|in\b|["″]|mm|cm|kg|oz|mah|nits?|atm|px|hours?|days?|shots?|frames?|grams?|g\b)(?![a-z]))/i;
const MONEY = /[$€£¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;

type Step = { kind: 'child'; at: number } | { kind: 'cell'; row: number; column: number };

export interface PieceGap {
  index: number;
  path: Step[];
  label: string;
  side?: string;
  /** The cell text before the placeholder. Empty when the piece had no data. */
  previous: string;
  missing: boolean;
  whole: boolean;
}

export interface GapRow {
  title?: string;
  snippet?: string;
  content?: string;
}

function measureNumbers(text: string): string[] {
  const bare = text.replace(/\s*\[(?:\d+\s*,\s*)*\d+\]/g, ' ');
  return [...bare.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

function keysOf(label: string): string[] {
  return label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4).map((word) => word.slice(0, 5));
}

function mentionsName(name: string, text: string): boolean {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (!tokens.length) return text.toLowerCase().includes(name.toLowerCase());
  const lead = tokens.reduce((best, word) => (word.length > best.length ? word : best));
  return new RegExp(`\\b${lead}\\b`, 'i').test(text);
}

function mentionsLabel(label: string, clause: string): boolean {
  const keys = keysOf(label);
  if (!keys.length) return false;
  const words = clause.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return keys.some((key) => words.some((word) => word.startsWith(key)));
}

/** A number and unit in the same clause as this row. A price row only takes a price. */
export function phraseForLabel(blob: string, label: string): string | undefined {
  const price = keysOf(label).some((key) => key.startsWith('pric') || key.startsWith('cost'));
  for (const sentence of blob.split(/(?<=[.!?])\s+/)) {
    for (const clause of sentence.split(/\s*(?:,|;|\band\b|\bwith\b)\s*/i)) {
      if (!mentionsLabel(label, clause)) continue;
      const money = clause.match(MONEY);
      if (price) {
        if (money) return money[0].replace(/\s/g, '');
        continue;
      }
      if (money && !measureNumbers(clause.replace(MONEY, ' ')).length) continue;
      const match = clause.match(MEASURE);
      if (match) return match[0].replace(/\s+/g, ' ').trim();
    }
  }
  return undefined;
}

function blobOf(row: GapRow): string {
  return `${row.title ?? ''}. ${row.snippet ?? ''} ${row.content ?? ''}`;
}

/**
 * A citation for this gap from the new rows, numbered from 1 inside that list.
 * A measured spec already written stays that spec. Undefined when the rows do not state it.
 */
export function citeForGap(gap: PieceGap, rows: readonly GapRow[]): string | undefined {
  const prior = measureNumbers(gap.previous);
  if (prior.length) {
    const hit = rows.findIndex((row) => prior.every((num) => blobOf(row).includes(num)));
    if (hit < 0) return undefined;
    return CITE.test(gap.previous) ? gap.previous : `${gap.previous} [${hit + 1}]`;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const where = `${row.title ?? ''} ${row.snippet ?? ''}`;
    if (gap.side && !mentionsName(gap.side, where)) continue;
    const phrase = phraseForLabel(blobOf(row), gap.label);
    if (phrase && aboutSide(gap.side, row, phrase)) return `${phrase} [${i + 1}]`;
  }
  return undefined;
}

/** A number from the other side of a versus page is not this side's figure. A page about this side alone still counts. */
function aboutSide(side: string | undefined, row: GapRow, phrase: string): boolean {
  if (!side) return true;
  const sentences = blobOf(row).split(/(?<=[.!?])\s+/);
  if (sentences.some((sentence) => sentence.includes(phrase) && mentionsName(side, sentence))) return true;
  const title = row.title ?? '';
  if (/\b(?:vs\.?|versus)\b/i.test(`${title} ${row.snippet ?? ''}`)) return false;
  return mentionsName(side, title);
}

/** The words to search: the question, the side, and the missing label. */
export function gapSearchQuery(question: string, gaps: readonly PieceGap[]): string {
  const parts = [question.trim()];
  const seen = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const gap of gaps) {
    for (const word of [gap.side, gap.label]) {
      const text = word?.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const token = text.toLowerCase();
      if (seen.has(token)) continue;
      seen.add(token);
      parts.push(text);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function sideName(columns: readonly string[], rows: readonly string[][], column: number): string {
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  const shown = [...Array(Math.max(0, width - columns.length)).fill(''), ...columns];
  return (shown[column] ?? '').trim();
}

function collect(node: CardNode, index: number, path: Step[], out: PieceGap[]) {
  if (node.type === 'tile') {
    const value = (node.value ?? '').trim();
    const cited = CITE.test(`${value} ${node.sub ?? ''}`) || node.source != null;
    const priced = MONEY.test(value);
    const pictured = !!(node.imageSrc || node.imageRef != null);
    if (!value && !pictured) out.push({ index, path, label: node.label, side: node.label, previous: '', missing: true, whole: true });
    else if (value && !cited && !priced && !pictured) out.push({ index, path, label: node.label, side: node.label, previous: value, missing: false, whole: true });
    return;
  }
  if (node.type === 'table') {
    node.rows.forEach((row, rowIndex) => {
      const factor = (row[0] ?? '').trim();
      if (!factor) return;
      row.forEach((cell, column) => {
        if (column === 0) return;
        const text = cell.trim();
        if (CITE.test(text) || MONEY.test(text) || measureNumbers(text).length > 0) return;
        const missing = !text || BLANK.test(text) || NOT_STATED.test(text);
        const side = sideName(node.columns, node.rows, column);
        out.push({
          index,
          path: [...path, { kind: 'cell', row: rowIndex, column }],
          label: factor,
          side,
          previous: missing ? '' : text,
          missing,
          whole: false,
        });
      });
    });
    return;
  }
  if ('children' in node && Array.isArray(node.children)) {
    node.children.forEach((child, at) => collect(child, index, [...path, { kind: 'child', at }], out));
  }
}

/** Missing pieces, blanks first. At most two, so one search does not rewrite the card. */
export function cardGaps(nodes: Iterable<[number, CardNode]>): PieceGap[] {
  const out: PieceGap[] = [];
  for (const [index, node] of nodes) {
    if (node.type === 'actions' || node.type === 'citations' || node.type === 'ticker') continue;
    collect(node, index, [], out);
  }
  out.sort((a, b) => Number(b.missing) - Number(a.missing));
  return out.slice(0, 2);
}

function writeCell(node: CardNode, path: readonly Step[], value: string): CardNode {
  if (!path.length) return node;
  const [head, ...rest] = path;
  if (!head) return node;
  if (head.kind === 'child' && 'children' in node && Array.isArray(node.children)) {
    const children = node.children.map((child, at) => (at === head.at ? writeCell(child, rest, value) : child));
    return { ...node, children } as CardNode;
  }
  if (head.kind === 'cell' && node.type === 'table' && !rest.length) {
    const rows = node.rows.map((row, rowIndex) => (
      rowIndex === head.row ? row.map((cell, column) => (column === head.column ? value : cell)) : row
    ));
    return { ...node, rows };
  }
  return node;
}

function nodeAt(node: CardNode, path: readonly Step[]): CardNode | undefined {
  let current: CardNode | undefined = node;
  for (const step of path) {
    if (!current || step.kind !== 'child' || !('children' in current) || !current.children) return undefined;
    current = current.children[step.at];
  }
  return current;
}

function writeNode(node: CardNode, path: readonly Step[], next: CardNode): CardNode {
  if (!path.length) return next;
  const [head, ...rest] = path;
  if (!head || head.kind !== 'child' || !('children' in node) || !Array.isArray(node.children)) return node;
  const children = node.children.map((child, at) => (at === head.at ? writeNode(child, rest, next) : child));
  return { ...node, children } as CardNode;
}

/** A placeholder for this piece only. Cited siblings stay. */
export function markGap(node: CardNode, gap: PieceGap): CardNode {
  if (!gap.whole) return writeCell(node, gap.path, GAP_MARK);
  const target = nodeAt(node, gap.path);
  const shape = target?.type === 'tile' ? 'tile' : 'line';
  return writeNode(node, gap.path, { type: 'slot', hint: gap.label, shape });
}

function replacesMeasure(previous: string, next: string): boolean {
  const prior = measureNumbers(previous);
  if (!prior.length) return false;
  const found = measureNumbers(next);
  return !prior.every((num) => found.includes(num));
}

/** Put the found text in, or put the previous text back. A measured spec is not swapped for a slogan. */
export function settleGap(node: CardNode, gap: PieceGap, found: string | undefined): CardNode {
  const text = found && !replacesMeasure(gap.previous, found) ? found : gap.previous;
  if (!gap.whole) return writeCell(node, gap.path, text);
  const target = nodeAt(node, gap.path);
  if (!target) return node;
  if (target.type === 'tile') return writeNode(node, gap.path, text ? { ...target, value: text } : target);
  if (target.type === 'text' || target.type === 'callout' || target.type === 'heading') {
    return writeNode(node, gap.path, text ? { ...target, text } : target);
  }
  return node;
}
