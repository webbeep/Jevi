import type { CardNode } from './card';

/** A table cell that is waiting on a search for just that missing piece. */
export const GAP_MARK = '[[gap]]';

const BLANK = /^[\s—–\-−~]*$/;

function hasCitedData(node: CardNode): boolean {
  if (node.type === 'actions' || node.type === 'citations' || node.type === 'slot' || node.type === 'ticker') return false;
  if (node.type === 'tile') return Boolean((node.value && node.value.trim()) || node.imageSrc || node.imageRef != null || node.source != null);
  if (node.type === 'table') return node.rows.some((row) => row.slice(1).some((cell) => cell.trim() && !BLANK.test(cell)));
  if (node.type === 'tabs') return node.tabs.some((tab) => tab.children.some(hasCitedData));
  if ('children' in node && Array.isArray(node.children) && node.children.length) return node.children.some(hasCitedData);
  return /\[\d+\]/.test(JSON.stringify(node));
}

/** Components that already have a citation, a price, a photo, or a filled cell. */
export function keptCardNodes(body: readonly CardNode[]): CardNode[] {
  return body.filter(hasCitedData);
}

/** True when this node, or something inside it, is a placeholder for one missing piece. */
export function hasGap(node: CardNode): boolean {
  if (node.type === 'slot') return true;
  if (node.type === 'table') return node.rows.some((row) => row.some((cell) => cell === GAP_MARK));
  if (node.type === 'tabs') return node.tabs.some((tab) => tab.children.some(hasGap));
  if ('children' in node && Array.isArray(node.children)) return node.children.some(hasGap);
  return false;
}
