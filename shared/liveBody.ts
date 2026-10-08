import type { CardNode } from './card';

/**
 * The body of a card that is still streaming (T455). Regions are designed in parallel and can arrive out of
 * order; a late earlier node would push everything below it down. So while designing, nodes are revealed in
 * index order: the arrived prefix, then the skeleton of the first gap, and later nodes wait until it fills.
 * When designing is over, every node that arrived is shown.
 */
export function liveBody(live: { nodes: (CardNode | undefined)[]; regions: CardNode[] }, stillDesigning: boolean): CardNode[] {
  if (!stillDesigning) return live.nodes.filter((n): n is CardNode => !!n);
  const out: CardNode[] = [];
  const length = Math.max(live.nodes.length, live.regions.length);
  for (let i = 0; i < length; i++) {
    const node = live.nodes[i];
    if (node) { out.push(node); continue; }
    const slot = live.regions[i];
    if (slot) out.push(slot);
    break;
  }
  return out;
}
