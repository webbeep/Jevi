/**
 * Diagram cards for "visualize", "explain how", and "diagram" questions.
 *
 * The model names a few stages and how they connect. A split or a join stays a
 * branch instead of being pulled into one line. ZO checks those words against the
 * sources and draws the graphic in a sandbox. A stage that is not in the sources
 * is left out. If fewer than three stages remain, the card stays a normal explanation.
 *
 * Off unless ZO_DIAGRAMS is 1, true, or yes.
 * Rollback: set ZO_DIAGRAMS to 0, or redeploy the previous build.
 */
import type { CardNode } from './card';

export type DiagramCard = Extract<CardNode, { type: 'diagram' }>;
export type DiagramKind = DiagramCard['kind'];

/** iframe sandbox for the graphic. Scripts run inside the frame and cannot read the page. */
export const DIAGRAM_SANDBOX = 'allow-scripts';

const STOP = new Set('a an the of to into and or how it its in on for with from by as at is are was were be this that these those then than not do does did'.split(' '));

/** True only when the preview (or a later rollout) opts in. Unset is off. */
export function diagramsEnabled(flag: string | undefined): boolean {
  const v = (flag ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * What kind of diagram a question is asking for.
 * A how-to, a measurement, a comparison, a chart, or a picture request is not a diagram.
 */
export function diagramIntent(question: string): DiagramKind | null {
  const s = question.trim();
  if (!s) return null;
  if (/\b(?:how to|how do i|how can i|explain how to|steps to|recipe for)\b/i.test(s)) return null;
  if (/\bhow (?:tall|many|much|long|old|far|big|heavy|often)\b/i.test(s)) return null;
  if (/\b(?:vs\.?|versus|difference between|differ(?:s|ence)?|compared? (?:to|with))\b/i.test(s) && !/\b(?:diagram|flowchart|schematic)\b/i.test(s)) return null;
  if (/\b(?:population|revenue|sales|ranking|statistics|chart|graph|plot)\b/i.test(s) && !/\bworks?\b|\bexplain how\b|\b(?:flowchart|process|cycle)\b/i.test(s)) return null;
  if (/\b(?:picture|photo|image|draw)\b/i.test(s) && !/\b(?:diagram|flowchart|schematic|works?|explain how)\b/i.test(s)) return null;
  const asked = /\b(?:visuali[sz]e|diagram|flowchart|flow chart|schematic)\b/i.test(s)
    || /\bexplain how\b/i.test(s)
    || /\bhow\b[\s\S]{0,60}\bworks?\b/i.test(s);
  if (!asked) return null;
  if (/\b(?:flowchart|flow chart|pipeline|process|cycle|sequence|stages?|becomes?)\b/i.test(s)) return 'flow';
  return 'concept';
}

/** Where the diagram hole sits: after the opening answer, and after a lead video when there is one. */
export function diagramSlotAt(hasLead: boolean, skeletonCount: number): number {
  if (skeletonCount <= 0) return hasLead ? 1 : 0;
  return hasLead ? 2 : 1;
}

/** Index of skeleton region `i` once the diagram hole is open. */
export function diagramRegionIndex(i: number, hasLead: boolean, diagramOn: boolean): number {
  const base = (hasLead ? 1 : 0) + i;
  if (!diagramOn) return base;
  const slot = diagramSlotAt(hasLead, 1);
  return base >= slot ? base + 1 : base;
}

const SLOT: CardNode = { type: 'slot', hint: 'How it fits together', shape: 'block' };

/** Layout placeholders with a diagram hole after the opening answer. */
export function layoutWithDiagram(regions: CardNode[], hasLead: boolean): CardNode[] {
  const cut = hasLead ? Math.min(regions.length, 2) : Math.min(regions.length, 1);
  return [...regions.slice(0, cut), SLOT, ...regions.slice(cut)];
}

/** Drops a diagram the page designer wrote. The diagram call is the only path that may add one. */
export function dropModelDiagram(node: CardNode): CardNode | undefined {
  if (node.type === 'diagram') return undefined;
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    const children = node.children.map(dropModelDiagram).filter((child): child is CardNode => !!child);
    return children.length ? { ...node, children } : undefined;
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs
      .map((tab) => ({ ...tab, children: tab.children.map(dropModelDiagram).filter((child): child is CardNode => !!child) }))
      .filter((tab) => tab.children.length);
    return tabs.length ? { ...node, tabs } : undefined;
  }
  return node;
}

function hostile(s: string): boolean {
  return /<|>|javascript:|onerror\s*=|onload\s*=/i.test(s);
}

function plain(s: string, max: number): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function contentWords(label: string): string[] {
  return label.toLowerCase().replace(/[-/]/g, ' ').match(/[a-z0-9]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
}

function numbersOk(text: string, corpus: string): boolean {
  const known = new Set((corpus.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')));
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) => {
    const token = n.replace(/,/g, '').replace(/\.0+$/, '');
    return known.has(token) || Number(token) <= 2;
  });
}

/** Article sections. They sit in the sources and are not how something works. */
const OUTLINE = new Set([
  'introduction', 'intro', 'overview', 'background', 'summary', 'conclusion', 'applications', 'application',
  'limitations', 'limitation', 'architecture', 'innovation', 'history', 'definition', 'basics', 'fundamentals',
  'examples', 'example', 'references', 'contents', 'abstract', 'discussion', 'about', 'advantages',
  'disadvantages', 'pros', 'cons', 'faq', 'training', 'key',
]);

/** "Introduction" / "Key Innovation" name a heading, not a part of the mechanism. */
function outlineLabel(label: string): boolean {
  const words = contentWords(label);
  return words.length > 0 && words.every((word) => OUTLINE.has(word));
}

function wordsIn(label: string, corpus: string): boolean {
  const words = contentWords(label);
  if (!words.length) return false;
  const hay = corpus.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function detailOk(detail: string, corpus: string): boolean {
  const words = contentWords(detail).filter((w) => w.length >= 5);
  if (!words.length) return numbersOk(detail, corpus);
  const hay = corpus.toLowerCase();
  const hit = words.filter((w) => hay.includes(w)).length;
  return numbersOk(detail, corpus) && hit >= Math.min(2, words.length) && hit / words.length >= 0.5;
}

type RawNode = { id: string; label: string; detail?: string };
type RawEdge = { from: string; to: string; label?: string };

/** Structural read used when a card is loaded. Drops markup. Does not check sources. */
export function readDiagram(raw: unknown): DiagramCard | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = raw as Record<string, unknown>;
  const kind = n.kind === 'flow' || n.kind === 'concept' ? n.kind : undefined;
  if (!kind || !Array.isArray(n.nodes)) return undefined;
  const nodes: RawNode[] = [];
  const idMap = new Map<string, string>();
  for (const item of n.nodes.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const labelRaw = typeof row.label === 'string' ? row.label : '';
    const detailRaw = typeof row.detail === 'string' ? row.detail : '';
    if (hostile(labelRaw) || (detailRaw && hostile(detailRaw))) continue;
    const label = plain(labelRaw, 48);
    if (label.length < 2) continue;
    const detail = detailRaw ? plain(detailRaw, 240) : undefined;
    const id = `n${nodes.length}`;
    if (typeof row.id === 'string' && row.id) idMap.set(row.id, id);
    idMap.set(id, id);
    nodes.push({ id, label, detail: detail || undefined });
  }
  if (nodes.length < 3) return undefined;
  const kept = nodes.slice(0, 6);
  const graph = finishGraph(kept, parseEdges(n.edges, idMap, new Set(kept.map((step) => step.id))));
  const titleRaw = typeof n.title === 'string' && !hostile(n.title) ? plain(n.title, 60) : '';
  const card: DiagramCard = { type: 'diagram', kind, title: titleRaw || undefined, nodes: graph.nodes, edges: graph.edges };
  if (kind === 'flow') card.mermaid = toMermaid(card);
  return card;
}

function sequential(nodes: { id: string }[]): RawEdge[] {
  const edges: RawEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  return edges;
}

function reaches(edges: RawEdge[], start: string, goal: string): boolean {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    const list = out.get(edge.from) ?? [];
    list.push(edge.to);
    out.set(edge.from, list);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of out.get(cur) ?? []) stack.push(nxt);
  }
  return false;
}

function hasBranch(edges: RawEdge[]): boolean {
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const edge of edges) {
    out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
    inn.set(edge.to, (inn.get(edge.to) ?? 0) + 1);
  }
  for (const count of out.values()) if (count > 1) return true;
  for (const count of inn.values()) if (count > 1) return true;
  return false;
}

function weakly(ids: string[], edges: RawEdge[]): Set<string>[] {
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!adj.has(edge.from) || !adj.has(edge.to)) continue;
    adj.get(edge.from)!.push(edge.to);
    adj.get(edge.to)!.push(edge.from);
  }
  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      comp.add(cur);
      for (const nxt of adj.get(cur) ?? []) stack.push(nxt);
    }
    components.push(comp);
  }
  return components;
}

/** Model edges whose ends survived. A back-edge that would loop is dropped. */
function parseEdges(raw: unknown, idMap: Map<string, string>, allowed: Set<string>, corpus?: string): RawEdge[] {
  if (!Array.isArray(raw)) return [];
  const edges: RawEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const from = typeof row.from === 'string' ? idMap.get(row.from) : undefined;
    const to = typeof row.to === 'string' ? idMap.get(row.to) : undefined;
    if (!from || !to || from === to || !allowed.has(from) || !allowed.has(to)) continue;
    const key = `${from}>${to}`;
    if (seen.has(key) || reaches(edges, to, from)) continue;
    seen.add(key);
    let label: string | undefined;
    if (typeof row.label === 'string' && !hostile(row.label)) {
      const text = plain(row.label, 18);
      const words = contentWords(text);
      const grounded = corpus === undefined ? text.length >= 2 : words.length > 0 && wordsIn(text, corpus);
      if (grounded) label = text;
    }
    edges.push({ from, to, label });
  }
  return edges;
}

/** Prefer a connected branch. A broken or empty graph falls back to one line. */
function finishGraph(nodes: RawNode[], modelEdges: RawEdge[]): { nodes: RawNode[]; edges: RawEdge[] } {
  const ids = nodes.map((step) => step.id);
  const components = weakly(ids, modelEdges);
  const scored = components.map((comp) => {
    const edges = modelEdges.filter((edge) => comp.has(edge.from) && comp.has(edge.to));
    return { comp, edges, branch: hasBranch(edges) };
  });
  const branched = scored.filter((item) => item.branch && item.comp.size >= 3).sort((a, b) => b.comp.size - a.comp.size)[0];
  const whole = components.length === 1 && components[0]!.size === nodes.length ? scored[0] : undefined;
  const chosen = branched ?? (whole && whole.edges.length ? whole : undefined);
  if (!chosen) return { nodes, edges: sequential(nodes) };
  if (chosen.comp.size === nodes.length) return { nodes, edges: chosen.edges };
  const next: RawNode[] = [];
  const map = new Map<string, string>();
  for (const step of nodes) {
    if (!chosen.comp.has(step.id)) continue;
    const id = `n${next.length}`;
    map.set(step.id, id);
    next.push({ ...step, id });
  }
  if (next.length < 3) return { nodes, edges: sequential(nodes) };
  return {
    nodes: next,
    edges: chosen.edges.map((edge) => ({ from: map.get(edge.from)!, to: map.get(edge.to)!, label: edge.label })),
  };
}

/**
 * Keeps a diagram only when its labels are in the sources (or the question, which is part of `corpus`).
 * `kind` is the kind the question asked for. The compiled Mermaid is ours, not the model's.
 */
/** The model named stages and none of them survived. Ask once more for real parts. */
export function diagramNeedsRetry(raw: unknown, accepted: DiagramCard | undefined): boolean {
  if (accepted) return false;
  if (!raw || typeof raw !== 'object') return false;
  const nodes = (raw as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) && nodes.length >= 3;
}

export function acceptDiagram(raw: unknown, corpus: string, kind: DiagramKind): DiagramCard | undefined {
  if (!raw || typeof raw !== 'object' || !corpus.trim()) return undefined;
  const n = raw as Record<string, unknown>;
  const body = n.type === 'diagram' || Array.isArray(n.nodes) ? n : undefined;
  if (!body || !Array.isArray(body.nodes)) return undefined;
  const nodes: RawNode[] = [];
  const idMap = new Map<string, string>();
  for (const item of body.nodes.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const labelRaw = typeof row.label === 'string' ? row.label : '';
    const detailRaw = typeof row.detail === 'string' ? row.detail : '';
    if (hostile(labelRaw) || (detailRaw && hostile(detailRaw))) continue;
    const label = plain(labelRaw, 48);
    if (label.length < 2 || outlineLabel(label) || !wordsIn(label, corpus) || !numbersOk(label, corpus)) continue;
    const named = detailRaw && contentWords(label).some((word) => word.length >= 4 && detailRaw.toLowerCase().includes(word));
    const detail = named && detailOk(detailRaw, corpus) ? plain(detailRaw, 240) : undefined;
    const id = `n${nodes.length}`;
    if (typeof row.id === 'string' && row.id) idMap.set(row.id, id);
    idMap.set(id, id);
    nodes.push({ id, label, detail: detail || undefined });
  }
  if (nodes.length < 3) return undefined;
  const kept = nodes.slice(0, 6);
  const graph = finishGraph(kept, parseEdges(body.edges, idMap, new Set(kept.map((step) => step.id)), corpus));
  const titleRaw = typeof body.title === 'string' && !hostile(body.title) ? plain(body.title, 60) : '';
  const title = titleRaw && wordsIn(titleRaw, corpus) ? titleRaw : undefined;
  const card: DiagramCard = { type: 'diagram', kind, title, nodes: graph.nodes, edges: graph.edges };
  if (kind === 'flow') card.mermaid = toMermaid(card);
  return card;
}

/** Mermaid flowchart for a flow. Labels are quoted text, never HTML. */
export function toMermaid(node: DiagramCard): string {
  const lines = ['flowchart TD'];
  node.nodes.forEach((step, i) => {
    lines.push(`  n${i}["${step.label.replace(/"/g, "'")}"]`);
  });
  const idOf = new Map(node.nodes.map((step, i) => [step.id, `n${i}`]));
  for (const edge of node.edges) {
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (!from || !to || from === to) continue;
    const label = edge.label ? `|${edge.label.replace(/[|"[\]]/g, ' ')}| ` : '';
    lines.push(`  ${from} --> ${label}${to}`);
  }
  return lines.join('\n');
}

const PAD = 16;
const GAP_X = 12;
const GAP_Y = 28;
const BOX_H = 40;
const BOX_H2 = 54;

export type DiagramBox = { i: number; x: number; y: number; w: number; h: number; lines: string[] };
export type DiagramWire = { d: string; label?: string; lx: number; ly: number };
export type DiagramLayout = { width: number; height: number; boxes: DiagramBox[]; wires: DiagramWire[] };

function wrapLabel(label: string, boxW: number): string[] {
  const max = Math.max(8, Math.floor((boxW - 20) / 7.1));
  if (label.length <= max) return [label];
  const words = label.split(' ');
  if (words.length < 2) return [label];
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  return [lines[0]!, lines.slice(1).join(' ')];
}

function layerOf(node: DiagramCard): number[] {
  const index = new Map(node.nodes.map((step, i) => [step.id, i]));
  const outgoing: number[][] = node.nodes.map(() => []);
  const indeg = node.nodes.map(() => 0);
  for (const edge of node.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    outgoing[from]!.push(to);
    indeg[to]! += 1;
  }
  const layer = node.nodes.map(() => 0);
  const queue: number[] = [];
  indeg.forEach((degree, i) => { if (degree === 0) queue.push(i); });
  const seen = new Set<number>();
  while (queue.length) {
    const i = queue.shift()!;
    if (seen.has(i)) continue;
    seen.add(i);
    for (const next of outgoing[i]!) {
      layer[next] = Math.max(layer[next]!, layer[i]! + 1);
      indeg[next]! -= 1;
      if (indeg[next] === 0) queue.push(next);
    }
  }
  return layer;
}

function orderRows(node: DiagramCard, layer: number[]): number[][] {
  const maxLayer = layer.reduce((max, value) => Math.max(max, value), 0);
  const rows: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  layer.forEach((value, i) => rows[value]!.push(i));
  const index = new Map(node.nodes.map((step, i) => [step.id, i]));
  const preds: number[][] = node.nodes.map(() => []);
  for (const edge of node.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined) continue;
    preds[to]!.push(from);
  }
  const pos = new Map<number, number>();
  for (const row of rows) {
    row.sort((a, b) => avgPos(preds[a]!, pos, a) - avgPos(preds[b]!, pos, b) || a - b);
    row.forEach((i, at) => pos.set(i, at));
  }
  return rows;
}

function avgPos(pred: number[], pos: Map<number, number>, self: number): number {
  if (!pred.length) return self;
  let sum = 0;
  let count = 0;
  for (const id of pred) {
    const at = pos.get(id);
    if (at === undefined) continue;
    sum += at;
    count++;
  }
  return count ? sum / count : self;
}

/** Places stages in rows. A split sits side by side; a join sits on the next row. */
export function layoutDiagram(node: DiagramCard, width: number): DiagramLayout {
  const viewW = Math.max(260, Math.round(width));
  const rows = orderRows(node, layerOf(node));
  const maxCols = Math.max(1, ...rows.map((row) => row.length));
  const available = viewW - PAD * 2;
  const boxW = Math.max(76, Math.floor((available - GAP_X * (maxCols - 1)) / maxCols));
  const boxes: DiagramBox[] = node.nodes.map((step, i) => ({ i, x: 0, y: 0, w: boxW, h: BOX_H, lines: [step.label] }));
  let y = PAD;
  for (const row of rows) {
    const rowW = row.length * boxW + Math.max(0, row.length - 1) * GAP_X;
    let x = PAD + (available - rowW) / 2;
    let rowH = BOX_H;
    const prepared = row.map((i) => {
      const lines = wrapLabel(node.nodes[i]!.label, boxW);
      const h = lines.length > 1 ? BOX_H2 : BOX_H;
      rowH = Math.max(rowH, h);
      return { i, lines, h };
    });
    for (const item of prepared) {
      boxes[item.i] = { i: item.i, x, y: y + (rowH - item.h) / 2, w: boxW, h: item.h, lines: item.lines };
      x += boxW + GAP_X;
    }
    y += rowH + GAP_Y;
  }
  const height = Math.max(PAD * 2 + BOX_H, y - GAP_Y + PAD);
  const wires: DiagramWire[] = [];
  for (const edge of node.edges) {
    const from = boxes[node.nodes.findIndex((step) => step.id === edge.from)];
    const to = boxes[node.nodes.findIndex((step) => step.id === edge.to)];
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const mid = y1 + Math.max(10, (y2 - y1) / 2);
    const d = Math.abs(x1 - x2) < 1.5
      ? `M ${num(x1)} ${num(y1)} L ${num(x2)} ${num(y2 - 1)}`
      : `M ${num(x1)} ${num(y1)} L ${num(x1)} ${num(mid)} L ${num(x2)} ${num(mid)} L ${num(x2)} ${num(y2 - 1)}`;
    wires.push({ d, label: edge.label, lx: (x1 + x2) / 2, ly: mid - 5 });
  }
  return { width: viewW, height, boxes, wires };
}

function num(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Iframe height for this width, including the caption under the drawing. */
export function diagramFrameHeight(node: DiagramCard, width: number): number {
  return layoutDiagram(node, width).height + (node.title ? 28 : 0) + 62;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? '');
}

/**
 * The graphic's document. It is shown in a sandboxed frame.
 * Boxes and arrowheads are drawn here. The only script is ours.
 * Stage text is escaped and also passed as JSON with < neutralized.
 */
function boxText(box: DiagramBox): string {
  const cx = box.x + box.w / 2;
  const size = box.w < 120 ? 12 : 14;
  if (box.lines.length < 2) {
    return `<text class="label" x="${num(cx)}" y="${num(box.y + box.h / 2 + 1)}" text-anchor="middle" dominant-baseline="middle" font-size="${size}">${esc(box.lines[0] ?? '')}</text>`;
  }
  const start = box.y + box.h / 2 - 6;
  const tspans = box.lines.map((line, i) => `<tspan x="${num(cx)}" dy="${i === 0 ? 0 : 15}">${esc(line)}</tspan>`).join('');
  return `<text class="label" x="${num(cx)}" y="${num(start)}" text-anchor="middle" font-size="12">${tspans}</text>`;
}

export function diagramDocument(node: DiagramCard, dark: boolean, width = 340): string {
  const text = dark ? '#f4f4f5' : '#18181b';
  const muted = dark ? '#a1a1aa' : '#52525b';
  const line = dark ? '#3f3f46' : '#d4d4d8';
  const fill = dark ? '#18181b' : '#ffffff';
  const soft = dark ? '#27272a' : '#f4f4f5';
  const layout = layoutDiagram(node, width);
  const radius = node.kind === 'flow' ? 8 : 14;
  const parts = [
    ...layout.wires.map((wire) => `<path class="arrow" d="${wire.d}" marker-end="url(#arrowhead)"/>${wire.label ? `<text class="edge" x="${num(wire.lx)}" y="${num(wire.ly)}" text-anchor="middle">${esc(wire.label)}</text>` : ''}`),
    ...layout.boxes.map((box) => `<g data-i="${box.i}" role="button" tabindex="0" aria-pressed="${box.i === 0 ? 'true' : 'false'}"><rect class="box" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${radius}"/>${boxText(box)}</g>`),
  ];
  const details = JSON.stringify(node.nodes.map((step) => step.detail ?? '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const mermaid = node.kind === 'flow' && node.mermaid ? `<pre hidden>${esc(node.mermaid)}</pre>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
    body{margin:0;overflow:hidden;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;color:${text};background:transparent}
    h2{margin:0 16px 8px;font-size:13px;font-weight:600;text-align:center}
    svg{display:block;width:100%;height:${layout.height}px}
    .box{fill:${fill};stroke:${line};stroke-width:1.5}
    [aria-pressed="true"] .box{fill:${soft};stroke:${text};stroke-width:2}
    text{fill:${text};font-family:ui-sans-serif,system-ui,sans-serif;pointer-events:none}
    .edge{font-size:10px;fill:${muted}}
    .arrow{stroke:${muted};stroke-width:1.5;fill:none}
    #detail{min-height:2.8em;margin:8px 16px 0;color:${muted};font-size:13px;line-height:1.45;text-align:center;text-wrap:balance}
  </style></head><body>
  ${node.title ? `<h2>${esc(node.title)}</h2>` : ''}
  <svg viewBox="0 0 ${layout.width} ${layout.height}" height="${layout.height}" role="img" aria-label="${esc(node.title || 'Diagram')}">
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="${muted}"/></marker></defs>
    ${parts.join('')}
  </svg>
  <p id="detail"></p>
  ${mermaid}
  <script type="application/json" id="d">${details}</script>
  <script data-zo="diagram">
    const details = JSON.parse(document.getElementById('d').textContent || '[]');
    const nodes = Array.from(document.querySelectorAll('[data-i]'));
    const panel = document.getElementById('detail');
    function show(i) {
      nodes.forEach((n, j) => n.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      const label = nodes[i] && nodes[i].querySelector('.label');
      panel.textContent = details[i] || (label ? label.textContent : '');
    }
    nodes.forEach((n) => {
      n.addEventListener('click', () => show(Number(n.dataset.i)));
      n.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        show(Number(n.dataset.i));
      });
    });
    show(0);
  </script>
  </body></html>`;
}
