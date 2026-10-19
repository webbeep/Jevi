import type { CardNode } from '../shared/card';
import { sameObject, threadObjects } from '../shared/objects';

const MONEY = /(?:\$|€|£|¥)\s?[\d,]+(?:\.\d{2})?/;

interface SourceRow {
  title?: string;
  snippet?: string;
  content?: string;
}

function numbersOf(text: string): string[] {
  const bare = text.replace(/\s*\[(?:\d+\s*,\s*)*\d+\]/g, ' ');
  return [...bare.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

function sourceNames(name: string, text: string): boolean {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2);
  const marks = tokens.filter((word) => /\d/.test(word));
  const words = tokens.filter((word) => word.length >= 4 && !/\d/.test(word));
  const hay = text.toLowerCase();
  if (words.length && !words.some((word) => hay.includes(word))) return false;
  if (marks.length && !marks.some((mark) => hay.includes(mark))) return false;
  return words.length > 0 || marks.length > 0;
}

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !/\d/.test(word));
}

/** "your traditional IRAs and Roth IRAs": both objects as one subject, so a figure in that sentence is each one's. */
function namedTogether(name: string, others: readonly string[], sentence: string): boolean {
  const mine = nameWords(name);
  const theirs = others.filter((other) => !sameObject(other, name)).flatMap(nameWords);
  if (!mine.length || !theirs.length) return false;
  const either = (words: string[]) => words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const join = '(?:\\s+\\S+)?\\s*(?:,|\\band\\b|\\bor\\b|&|\\/)\\s*(?:\\S+\\s+)?';
  return new RegExp(`\\b(?:${either(mine)})\\b${join}\\b(?:${either(theirs)})\\b|\\b(?:${either(theirs)})\\b${join}\\b(?:${either(mine)})\\b`, 'i').test(sentence);
}

/** A source that names this object also states this number. */
function statedFor(name: string, value: string, sources: readonly SourceRow[], others: readonly string[] = []): boolean {
  const nums = numbersOf(value);
  if (!nums.length) return true;
  return sources.some((source) => {
    const blob = `${source.title ?? ''}. ${source.snippet ?? ''} ${source.content ?? ''}`;
    for (const sentence of blob.split(/(?<=[.!?])\s+/)) {
      if (namedTogether(name, others, sentence) && nums.every((num) => sentence.includes(num))) return true;
      for (const clause of sentence.split(/\s*(?:;|\band\b|\bwith\b|,(?!\d))\s*/i)) {
        if (!sourceNames(name, clause)) continue;
        if (nums.every((num) => clause.includes(num))) return true;
      }
    }
    return false;
  });
}

function foreignNumber(name: string, value: string, objects: ReturnType<typeof threadObjects>): boolean {
  const nums = numbersOf(value);
  if (!nums.length) return false;
  return objects.some((object) => !sameObject(object.name, name) && nums.some((num) => object.facts.some((fact) => numbersOf(fact).includes(num))));
}

function clearMoney(value: string): string {
  return value.replace(MONEY, '').replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
}

function edit(node: CardNode, objects: ReturnType<typeof threadObjects>, sources: readonly SourceRow[]): CardNode {
  if (node.type === 'tile') {
    let next = node;
    if (next.value && foreignNumber(next.label, next.value, objects) && !statedFor(next.label, next.value, sources, objects.map((object) => object.name))) {
      const value = clearMoney(next.value);
      // "Under $100" without its price is "Under": a value that was a price says nothing once the price goes.
      next = value && /\d/.test(value) ? { ...next, value } : { ...next, value: undefined };
    }
    if (next.imageSrc) {
      const owner = objects.find((object) => object.facts.includes(`photo ${next.imageSrc}`));
      if (owner && !sameObject(owner.name, next.label)) next = { ...next, imageSrc: undefined, imageRef: undefined };
    }
    return next;
  }
  if (node.type === 'table') {
    const width = Math.max(node.columns.length, ...node.rows.map((row) => row.length));
    const columns = [...Array(Math.max(0, width - node.columns.length)).fill(''), ...node.columns];
    const rows = node.rows.map((row) => row.map((cell, column) => {
      if (column === 0) return cell;
      const name = String(columns[column] ?? '').trim();
      if (!name || !foreignNumber(name, cell, objects) || statedFor(name, cell, sources, objects.map((object) => object.name))) return cell;
      return '';
    }));
    const same = rows.every((row, index) => row.every((cell, column) => cell === node.rows[index]?.[column]));
    return same ? node : { ...node, rows };
  }
  if (node.type === 'tabs') return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => edit(child, objects, sources)) })) };
  if ('children' in node && Array.isArray(node.children)) {
    const children = node.children.map((child) => edit(child, objects, sources));
    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } as CardNode : node;
  }
  return node;
}

/**
 * A number that belongs to one object does not stay on a different object
 * unless a source that names that object states it.
 */
export function unblendObjects(
  nodes: Map<number, CardNode>,
  prior: readonly CardNode[],
  sources: readonly SourceRow[],
): { index: number; node: CardNode }[] | undefined {
  const known = threadObjects([{ body: prior }, { body: [...nodes.values()] }]);
  if (known.length < 2) return undefined;
  const patches: { index: number; node: CardNode }[] = [];
  for (const [index, node] of nodes) {
    const next = edit(node, known, sources);
    if (next !== node) patches.push({ index, node: next });
  }
  return patches.length ? patches : undefined;
}
