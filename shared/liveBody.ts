import type { CardNode } from './card';

/** A region the server collapsed away. It is not a skeleton waiting to be filled. */
export function isBlankLayout(node: CardNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'scroller') return node.children.length === 0;
  if (node.type === 'section') return node.children.length === 0 && !node.title;
  if (node.type === 'tabs') return node.tabs.length === 0;
  if (node.type === 'keyvalue') return node.items.length === 0;
  if (node.type === 'actions') return node.items.length === 0;
  return false;
}

/** A section that is actually an answer, not a placeholder, a collapsed region, or the source list. */
function showsAnswer(node: CardNode | undefined): node is CardNode {
  return !!node && node.type !== 'slot' && node.type !== 'citations' && !isBlankLayout(node);
}

/**
 * The body of a card that is still streaming. Each region of the chosen layout is designed in its own
 * call and can finish before the one above it. The waiting layout is the full skeleton, and it is only
 * shown before any real component arrives. Once a slot's own component is in, that slot is the component:
 * an empty slot is not drawn beside it, so its skeleton does not keep shimmering after the sentence.
 * Nodes after the layout (the optional control, actions, citations) stay in index order and wait out a
 * hole, because a late one would push the ones below it down and those holes were never on screen.
 * When nothing real has arrived yet, return nothing — the waiting layout is already the full skeleton.
 * When designing is over, every node that arrived is shown and gaps are dropped.
 */
export function liveBody(live: { nodes: (CardNode | undefined)[]; regions: CardNode[] }, stillDesigning: boolean): CardNode[] {
  if (!stillDesigning) return live.nodes.filter((n): n is CardNode => !!n && !isBlankLayout(n));
  if (!live.nodes.some(showsAnswer)) return [];
  const out: CardNode[] = [];
  for (let i = 0; i < live.regions.length; i++) {
    const node = live.nodes[i];
    if (!node || isBlankLayout(node)) continue;
    // A slot here is one missing piece the server is searching, not the empty layout.
    out.push(node);
  }
  for (let i = live.regions.length; i < live.nodes.length; i++) {
    const node = live.nodes[i];
    if (!node) break;
    if (isBlankLayout(node)) continue;
    out.push(node);
  }
  return out;
}
