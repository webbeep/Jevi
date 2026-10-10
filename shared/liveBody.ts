import type { CardNode } from './card';

/**
 * The body of a card that is still streaming (T455). Regions are designed in parallel and can arrive out of
 * order; a late earlier node would push everything below it down. So while designing, nodes are revealed in
 * index order: the arrived prefix, and later nodes wait until the gap fills. The gap stays empty — a flashing
 * skeleton there reads as a fake placeholder rather than work happening.
 * When designing is over, every node that arrived is shown.
 */
export function liveBody(live: { nodes: (CardNode | undefined)[]; regions: CardNode[] }, stillDesigning: boolean): CardNode[] {
  if (!stillDesigning) return live.nodes.filter((n): n is CardNode => !!n);
  const out: CardNode[] = [];
  const length = Math.max(live.nodes.length, live.regions.length);
  for (let i = 0; i < length; i++) {
    const node = live.nodes[i];
    if (!node) break;
    out.push(node);
  }
  return out;
}
