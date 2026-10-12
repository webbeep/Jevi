/**
 * Diagram cards for "visualize", "explain how", and "diagram" questions.
 *
 * The model names a few stages. ZO checks those words against the sources, compiles
 * a Mermaid flowchart for a flow, and draws one sandboxed graphic. A stage that is
 * not in the sources is left out. If fewer than three stages remain, the card stays
 * a normal explanation and no diagram is shown.
 *
 * Off unless ZO_DIAGRAMS is 1, true, or yes. Set that on the experiment preview only.
 * Rollback: set ZO_DIAGRAMS to 0 on that preview, or redeploy the previous experiment
 * build. Production keeps the old behavior until the flag is turned on there.
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
  for (const item of n.nodes.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const labelRaw = typeof row.label === 'string' ? row.label : '';
    const detailRaw = typeof row.detail === 'string' ? row.detail : '';
    if (hostile(labelRaw) || (detailRaw && hostile(detailRaw))) continue;
    const label = plain(labelRaw, 48);
    if (label.length < 2) continue;
    const detail = detailRaw ? plain(detailRaw, 240) : undefined;
    nodes.push({ id: `n${nodes.length}`, label, detail: detail || undefined });
  }
  if (nodes.length < 3) return undefined;
  const kept = nodes.slice(0, 6);
  const edges = sequential(kept);
  const titleRaw = typeof n.title === 'string' && !hostile(n.title) ? plain(n.title, 60) : '';
  const card: DiagramCard = { type: 'diagram', kind, title: titleRaw || undefined, nodes: kept, edges };
  if (kind === 'flow') card.mermaid = toMermaid(card);
  return card;
}

function sequential(nodes: { id: string }[]): RawEdge[] {
  const edges: RawEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  return edges;
}

/**
 * Keeps a diagram only when its labels are in the sources (or the question, which is part of `corpus`).
 * `kind` is the kind the question asked for. The compiled Mermaid is ours, not the model's.
 */
export function acceptDiagram(raw: unknown, corpus: string, kind: DiagramKind): DiagramCard | undefined {
  if (!raw || typeof raw !== 'object' || !corpus.trim()) return undefined;
  const n = raw as Record<string, unknown>;
  const body = n.type === 'diagram' || Array.isArray(n.nodes) ? n : undefined;
  if (!body || !Array.isArray(body.nodes)) return undefined;
  const nodes: RawNode[] = [];
  for (const item of body.nodes.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const labelRaw = typeof row.label === 'string' ? row.label : '';
    const detailRaw = typeof row.detail === 'string' ? row.detail : '';
    if (hostile(labelRaw) || (detailRaw && hostile(detailRaw))) continue;
    const label = plain(labelRaw, 48);
    if (label.length < 2 || !wordsIn(label, corpus) || !numbersOk(label, corpus)) continue;
    const detail = detailRaw && detailOk(detailRaw, corpus) ? plain(detailRaw, 240) : undefined;
    nodes.push({ id: `n${nodes.length}`, label, detail: detail || undefined });
  }
  if (nodes.length < 3) return undefined;
  const kept = nodes.slice(0, 6);
  const titleRaw = typeof body.title === 'string' && !hostile(body.title) ? plain(body.title, 60) : '';
  const title = titleRaw && wordsIn(titleRaw, corpus) ? titleRaw : undefined;
  const card: DiagramCard = { type: 'diagram', kind, title, nodes: kept, edges: sequential(kept) };
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
    lines.push(`  ${from} -->${label}${to}`);
  }
  return lines.join('\n');
}

export function diagramHeight(count: number): number {
  const n = Math.max(1, count);
  return 36 + n * 52 + Math.max(0, n - 1) * 18 + 72;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? '');
}

/**
 * The graphic's document. It is shown in a sandboxed frame.
 * The only script is ours; stage text is escaped and also passed as JSON with < neutralized.
 */
export function diagramDocument(node: DiagramCard, dark: boolean): string {
  const text = dark ? '#f4f4f5' : '#18181b';
  const muted = dark ? '#a1a1aa' : '#52525b';
  const line = dark ? '#3f3f46' : '#d4d4d8';
  const fill = dark ? '#18181b' : '#ffffff';
  const soft = dark ? '#27272a' : '#f4f4f5';
  const steps = node.nodes.map((step, i) => {
    const arrow = node.kind === 'flow' && i < node.nodes.length - 1 ? '<span class="arrow" aria-hidden="true"></span>' : '';
    return `<button type="button" data-i="${i}" aria-pressed="${i === 0 ? 'true' : 'false'}"><span class="n">${i + 1}</span><span class="label">${esc(step.label)}</span></button>${arrow}`;
  }).join('');
  const details = JSON.stringify(node.nodes.map((step) => step.detail ?? '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const mermaid = node.kind === 'flow' && node.mermaid ? `<pre hidden>${esc(node.mermaid)}</pre>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
    body{margin:0;font:14px/1.35 ui-sans-serif,system-ui,sans-serif;color:${text};background:transparent}
    h2{margin:0 0 8px;font-size:13px;font-weight:600}
    button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid ${line};background:${fill};color:${text};border-radius:10px;padding:8px 10px;cursor:pointer}
    button[aria-pressed="true"]{background:${soft};border-color:${text}}
    .n{flex:0 0 auto;width:22px;height:22px;border-radius:999px;border:1px solid ${line};display:flex;align-items:center;justify-content:center;font-size:12px}
    .label{min-width:0}
    .arrow{display:block;width:2px;height:14px;margin:2px auto;background:${muted}}
    #detail{min-height:44px;margin:10px 0 0;color:${muted};font-size:13px}
  </style></head><body>
  ${node.title ? `<h2>${esc(node.title)}</h2>` : ''}
  <div id="steps">${steps}</div>
  <p id="detail"></p>
  ${mermaid}
  <script type="application/json" id="d">${details}</script>
  <script data-zo="diagram">
    const details = JSON.parse(document.getElementById('d').textContent || '[]');
    const buttons = Array.from(document.querySelectorAll('button'));
    const panel = document.getElementById('detail');
    function show(i) {
      buttons.forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      panel.textContent = details[i] || buttons[i].querySelector('.label').textContent || '';
    }
    buttons.forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.i))));
    show(0);
  </script>
  </body></html>`;
}
