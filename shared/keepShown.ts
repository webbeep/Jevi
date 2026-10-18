import type { CardNode } from './card';

const GENERIC = /^(?:stat|stats|factor|factors|metric|metrics|value|values|category|item|name|total|average|avg|player|players|team|product|products|model|spec|specs)$/i;

/** Labels that name a side: a column, a row, a tile, or a section. A generic header is not one. */
export function structureLabels(node: CardNode): string[] {
  const labels: string[] = [];
  const add = (label: string) => {
    const text = label.replace(/\s+/g, ' ').trim();
    if (text.length < 2 || GENERIC.test(text) || !/[a-z]/i.test(text)) return;
    if (labels.some((have) => have.toLowerCase() === text.toLowerCase())) return;
    labels.push(text);
  };
  const walk = (item: CardNode) => {
    if (item.type === 'table') {
      item.columns.forEach((column, index) => {
        if (index > 0) add(column);
      });
      item.rows.forEach((row) => add(row[0] ?? ''));
    }
    if (item.type === 'tile') add(item.label);
    if (item.type === 'section' && item.title) add(item.title);
    if (item.type === 'stat') add(item.label);
    if ('children' in item && Array.isArray(item.children)) item.children.forEach(walk);
    if (item.type === 'tabs') item.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  walk(node);
  return labels;
}

function hasNumber(node: CardNode): boolean {
  const bare = JSON.stringify(node).replace(/\s*\[(?:\d+\s*,\s*)*\d+\]/g, ' ');
  return /\d/.test(bare);
}

/** A component that names at least two sides and states a number. */
export function isMeasuredBreakdown(node: CardNode | undefined): boolean {
  if (!node) return false;
  return structureLabels(node).length >= 2 && hasNumber(node);
}

function containsNode(tree: CardNode, target: CardNode): boolean {
  if (tree === target || JSON.stringify(tree) === JSON.stringify(target)) return true;
  if ('children' in tree && Array.isArray(tree.children)) {
    if (tree.children.some((child) => containsNode(child, target))) return true;
  }
  if (tree.type === 'tabs') return tree.tabs.some((tab) => tab.children.some((child) => containsNode(child, target)));
  return false;
}

/**
 * A breakdown already on screen stays. A later node may correct it when every
 * side it named is still there, and a wrap may put photos or a warning around
 * that same breakdown. A different card does not take its place.
 */
export function keepShownComponent(current: CardNode | undefined, incoming: CardNode): CardNode {
  if (!current || !isMeasuredBreakdown(current)) return incoming;
  if (current.type !== incoming.type) return containsNode(incoming, current) ? incoming : current;
  const have = new Set(structureLabels(incoming).map((label) => label.toLowerCase()));
  const covered = structureLabels(current).every((label) => have.has(label.toLowerCase()));
  return covered ? incoming : current;
}
