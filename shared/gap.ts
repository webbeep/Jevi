import type { CardNode } from './card';

/** A table cell that is waiting on a search for just that missing piece. */
export const GAP_MARK = '[[gap]]';

/** True when this node, or something inside it, is a placeholder for one missing piece. */
export function hasGap(node: CardNode): boolean {
  if (node.type === 'slot') return true;
  if (node.type === 'table') return node.rows.some((row) => row.some((cell) => cell === GAP_MARK));
  if (node.type === 'tabs') return node.tabs.some((tab) => tab.children.some(hasGap));
  if ('children' in node && Array.isArray(node.children)) return node.children.some(hasGap);
  return false;
}
