import type { CardNode } from './card';

/** A section that is actually an answer, not a placeholder or the source list. */
function showsAnswer(node: CardNode | undefined): node is CardNode {
  return !!node && node.type !== 'slot' && node.type !== 'citations';
}

/**
 * The body of a card that is still streaming. Each region of the chosen layout is designed in its own
 * call and can finish before the one above it. Once any real section has arrived, show the whole layout:
 * arrived sections in place, and that region's own skeleton where its call is still running, so a later
 * section does not jump when an earlier hole fills.
 * Nodes after the layout (the optional control, actions, citations) stay in index order and wait out a
 * hole, because a late one would push the ones below it down and those holes were never on screen.
 * When nothing real has arrived yet, return nothing — the waiting layout is already the full skeleton.
 * When designing is over, every node that arrived is shown and gaps are dropped.
 */
export function liveBody(live: { nodes: (CardNode | undefined)[]; regions: CardNode[] }, stillDesigning: boolean): CardNode[] {
  if (!stillDesigning) return live.nodes.filter((n): n is CardNode => !!n);
  if (!live.nodes.some(showsAnswer)) return [];
  const out: CardNode[] = [];
  for (let i = 0; i < live.regions.length; i++) {
    out.push(live.nodes[i] ?? live.regions[i] ?? { type: 'slot', hint: 'answer', shape: 'block' });
  }
  for (let i = live.regions.length; i < live.nodes.length; i++) {
    const node = live.nodes[i];
    if (!node) break;
    out.push(node);
  }
  return out;
}
