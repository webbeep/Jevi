import type { AnswerCard, CardNode, FollowupContext, LayoutPlan } from '../shared/card';
import type { SearchResponse } from '../shared/types';
import { deepseekLines, hasDeepSeek } from './deepseek';
import { candidates, extractStats, extractTimeline } from './extract';
import { Grounding, groundNodes } from './ground';
import type { PageText } from './pages';
import { patternById } from './patterns';
import { sanitizeCard, sanitizeNodes } from './sanitize';
import { clip, type Env } from './util';

const GRAMMAR = `Each node is a JSON object with a "type" field.
LAYOUT
- stack {direction:"row"|"col", gap:"sm"|"md"|"lg", align:"start"|"center"|"end"|"between", wrap:boolean, children:[nodes]}
- grid {cols:2|3|4, children:[nodes]}  (collapses to fewer columns on phones)
- section {title, icon, tone, children:[nodes]}  (a titled sub-panel)
- tabs {tabs:[{label, children:[nodes]}]}
- scroller {children:[nodes]}  (horizontal swipe row, great for a series of tiles)
- divider {}
DISPLAY
- hero {value, unit, label, caption, icon, tone}  (the single most important value, rendered huge)
- heading {text, eyebrow, level:1|2|3}
- text {text, tone, size:"sm"|"md"|"lg"}  (supports **bold** and [n] source citations)
- stat {label, value, unit, icon, delta, trend:"up"|"down"|"flat"}
- tile {label, value, sub, icon, imageRef:image index, active:boolean}  (compact cell for scrollers and grids; with imageRef it becomes a picture tile, great for products, places, dishes, people)
- keyvalue {items:[{label, value, icon}]}
- list {style:"bullet"|"check"|"number"|"icon"|"media", items:[{text, icon, meta, imageRef}]}  ("media" shows each item as a row with a thumbnail; meta is a short badge like a price or score)
- chart {kind:"bar"|"line"|"area", title, unit, data:[{label, value:number}]}  (only with 3+ real numbers)
- progress {label, value:0-100, caption}
- rating {value, max, label}
- table {columns:[string], rows:[[string]], highlight:column index}
- timeline {items:[{when, title, text}]}
- steps {items:[{title, detail}]}
- proscons {pros:[string], cons:[string]}
- badges {items:[string]}
- quote {text, source}
- callout {tone, title, text, icon}
- image {ref:image index, caption, aspect:"wide"|"square"|"tall"}
- gallery {refs:[image indexes]}
- profile {name, subtitle, imageRef:image index, facts:[{label, value}]}
- actions {items:[{label, icon, query, kind:"search"|"ask"|"refine"}]}  (next-step buttons: "refine" redesigns THIS card with the query as an instruction, "ask" answers a follow-up in a new card, "search" runs a new search)
- citations {refs:[source numbers]}
INTERACTIVE (make the card something to play with, not just read)
- choices {label, options:[{label, prompt, selected}]}  (segmented control; picking an option redesigns the card using its prompt, e.g. time range, focus, audience)
- slider {label, min, max, step, value, unit, prompt}  (prompt must contain {value}; releasing the slider redesigns the card, e.g. "plan for {value} people")
- scaler {label, base, value, min, max, step, unit, items:[{name, amount:number, unit}]}  (live, instant rescaling of quantities such as ingredients or costs; base is the amount the sources describe, value is where the control starts, e.g. the amount the person asked for)
- accordion {items:[{title, text}]}  (tap to expand details)
- reveal {items:[{front, back}]}  (tap-to-flip cards for quizzes, myths vs facts, terms)
icon: any lucide icon name in kebab-case, e.g. "thermometer", "map-pin", "clock", "trending-up".
tone: "default"|"muted"|"primary"|"positive"|"negative"|"warning".`;

const DEPTH_HINT = {
  brief: 'Keep it to a glance: 3-4 top-level nodes, almost no prose.',
  standard: 'Aim for 4-6 top-level nodes.',
  detailed: 'Be thorough but tidy: up to 8 top-level nodes, grouping extra detail into tabs or accordions.',
} as const;

function sourcesBlock(search: SearchResponse, pages: PageText[], pageChars = 2800): string {
  const results = search.results.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title} (${r.domain}${r.date ? `, ${r.date}` : ''}): ${clip(r.snippet, 420)}`);
  const pageBlock = pages.length ? `\n\nPAGE TEXT (readable content of some sources, cite with the same number)\n${pages.map((p) => `[${p.n}] ${clip(p.text, pageChars)}`).join('\n\n')}` : '';
  const knowledge = search.knowledge ? `\nEncyclopedia (${search.knowledge.url}): ${search.knowledge.title} — ${clip(search.knowledge.extract, 900)}` : '';
  const images = search.images.slice(0, 12).map((img, i) => `${i}: ${img.title || img.source}`);
  return `SOURCES\n${results.join('\n')}${knowledge}${pageBlock}\n\nIMAGES (use by index)\n${images.join('\n') || 'none'}`;
}

export interface DesignRequest {
  query: string;
  pattern: string;
  depth: LayoutPlan['depth'];
  search: SearchResponse;
  pages: PageText[];
  simple?: boolean;
  followup?: FollowupContext;
  /** Compact summary of earlier turns, for resolving references in follow-ups. */
  context?: string;
}

export interface DesignEvents {
  /** Placeholder regions that indexed nodes will fill (parallel design only). */
  layout: (regions: CardNode[]) => void;
  head: (head: Omit<AnswerCard, 'body'>) => void;
  /** `index` is the node's position in the card; parallel regions may arrive out of order. */
  node: (node: CardNode, index: number) => void;
  followups: (items: string[]) => void;
}

export interface DesignSummary {
  engine: 'deepseek' | 'extractive';
  removed: number;
}

function followupRules(f: FollowupContext | undefined, originalQuery: string): string {
  if (!f) return '';
  switch (f.mode) {
    case 'refine':
      return `\n\nTHIS IS A REDESIGN. The person is looking at CURRENT CARD (below) for "${originalQuery}" and asked: "${f.question}". Output the full updated card: apply the change, keep what still applies, and restructure freely if the change calls for a different layout. Mark the matching choices option as selected and move any slider or scaler to the requested value.`;
    case 'answer':
      return `\n\nTHIS IS A FOLLOW-UP. The original search was "${originalQuery}". Design a focused card that answers only the follow-up question "${f.question}". Do not repeat the original answer; pick the components that fit this question best.`;
    default: {
      const unreachable: never = f.mode;
      return unreachable;
    }
  }
}

const DESIGNER = `You are the UI designer of a visual search engine. Every query gets one answer card, like a purpose-built app screen for exactly this answer: think about what a person expects to see and how a dedicated app would present it (a live reading gets a huge hero number with a swipeable series of tiles; a recipe gets time and servings tiles then numbered steps; a comparison gets a table and a verdict). Compose from the grammar below, choosing the components and arrangement that make the answer instantly readable.

${GRAMMAR}

STYLE — visual first, minimal text
- Show, don't tell: numbers, icons, pictures, charts, tables and timelines carry the answer; words only label them. The card should be understood in a 3-second glance.
- Never restate the card title as a heading; the header already shows it.
- If the sources only support a few facts, make the card shorter: drop any skeleton slot you cannot fill with new information instead of rephrasing something already shown.
- Text budget: labels 1-4 words; tile and stat values as short as possible; subtitles under 10 words; a text node is 1-2 short sentences. Never repeat the same fact in two places. No filler ("Here is", "In summary", "It is important to note").
- When the person wants to understand something (why/how/what is, or an explainer layout), explanation is the content: use clear, plain sentences in short paragraphs or an accordion, keep every step of the reasoning (don't skip what a newcomer needs), and add a one-line analogy. Still concise.
- Pictures: when IMAGES contains pictures that clearly show the subject (check each image's description), use them — a profile image, a gallery, picture tiles for options, or a media list for ranked items. Never use an image whose description is about something else.

RULES
- Every number, value and fact must come from SOURCES or PAGE TEXT. Never estimate, never use typical or example values, never fill a slot from general knowledge. Any number not found in the sources is automatically deleted, so leave such nodes out.
- Never compute new numbers yourself (multiplying, converting, summing). When quantities should change with an amount (servings, loaves, people, budget), use a scaler node whose base and amounts are exactly the source values; the person rescales it live.
- If the sources don't contain what the person asked for (for example a live reading or a price), say so honestly in a short callout and point to the best sources to check.
- Put citations like [2] inside text nodes where useful. Prefer visual components (hero, tiles, stats, charts, tables, timelines) over paragraphs; keep text short.
- Nesting depth at most 4.`;

/** Both system prompts are identical across requests so the provider can cache them. */
const SYSTEM_WHOLE = `${DESIGNER}
- Start from the SKELETON layout given in the TASK. Replace every slot with real components; you may add, drop or rearrange nodes if it serves the answer better.
- Lead with the answer: the first body node must be small and already useful on its own (a hero or a one-sentence answer), so it appears on screen immediately.
- Include at least one interactive node (choices, slider, scaler, accordion or reveal) whenever the answer has something worth adjusting, exploring or testing.
- Finish with an actions node (2-4 useful next steps; prefer "refine" for changes to this card) and a citations node.

OUTPUT FORMAT — JSON Lines, streamed to the screen as you write:
Line 1: {"title":string,"subtitle":string,"icon":string,"accent":tone}
Then exactly one line per top-level body node, each a complete compact JSON object (children nested inside it).
Last line: {"followups":[4 short follow-up questions]}
No code fences, no prose, no blank lines, no line breaks inside a JSON object.`;

const SYSTEM_REGION = `${DESIGNER}
- You are one of several designers building the same card in parallel. The TASK tells you which part is yours and what the others cover; stay in your lane and never repeat their content. If your region is a list of items (picks, options, places), it holds the whole list.
- Output only what the TASK asks for, as JSON Lines: one complete compact JSON object per line. Every node carries a \"type\" field, e.g. {\"type\":\"hero\",...}. No code fences, no prose, no blank lines, no line breaks inside a JSON object.`;

function taskBlock(req: DesignRequest): string {
  const pattern = patternById(req.pattern);
  return [
    `- Pre-selected layout: "${pattern.label}" (${pattern.description}).`,
    `- ${DEPTH_HINT[req.depth]}`,
    req.simple ? '- Write for a 10-year-old: plain words and a friendly analogy.' : '',
    followupRules(req.followup, req.search.query).trim().replace(/^/, '- '),
    req.context ? `- Conversation so far (use it to resolve references like "it" or "the cheaper one"; don't repeat it):\n${req.context}` : '',
  ]
    .filter((l) => l && l !== '- ')
    .join('\n');
}

function corpusOf(req: DesignRequest): string {
  return [
    req.query,
    req.followup?.question ?? '',
    req.followup?.baseCard ? JSON.stringify(req.followup.baseCard) : '',
    ...req.search.results.map((r) => `${r.title} ${r.snippet} ${r.date ?? ''}`),
    req.search.knowledge?.extract ?? '',
    ...req.pages.map((p) => p.text),
  ].join(' ');
}

type Parsed = { kind: 'head'; head: Omit<AnswerCard, 'body'> } | { kind: 'node'; node: CardNode } | { kind: 'followups'; items: string[] } | { kind: 'dropped' };

/** Parses one streamed output line into a sanitized, grounded piece of the card. */
function parseLine(line: string, g: Grounding, imageCount: number, query: string): Parsed | undefined {
  const json = line.replace(/^```(?:json)?|```$/g, '').replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/,$/, '').trim();
  if (!json.startsWith('{')) return undefined;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (Array.isArray(obj.followups)) return { kind: 'followups', items: obj.followups.filter((f): f is string => typeof f === 'string').slice(0, 4) };
  // Models sometimes key a node by its type ({"actions": {...}}) instead of using a "type" field.
  const keys = Object.keys(obj);
  if (!('type' in obj) && keys.length === 1 && NODE_TYPES.has(keys[0]) && obj[keys[0]] && typeof obj[keys[0]] === 'object') {
    obj = { type: keys[0], ...(obj[keys[0]] as Record<string, unknown>) };
  }
  if (!('type' in obj)) {
    const head = sanitizeCard({ ...obj, body: [] }, imageCount, query);
    return { kind: 'head', head: { title: head.title, subtitle: head.subtitle && g.ok(head.subtitle) ? head.subtitle : undefined, icon: head.icon, accent: head.accent } };
  }
  const [clean] = sanitizeNodes([obj], imageCount);
  const [grounded] = clean ? groundNodes([clean], g) : [];
  return grounded ? { kind: 'node', node: grounded } : { kind: 'dropped' };
}

const NODE_TYPES = new Set<string>(['stack', 'grid', 'section', 'tabs', 'scroller', 'divider', 'hero', 'heading', 'text', 'stat', 'tile', 'keyvalue', 'list', 'chart', 'progress', 'rating', 'table', 'timeline', 'steps', 'proscons', 'badges', 'quote', 'callout', 'image', 'gallery', 'profile', 'actions', 'choices', 'slider', 'scaler', 'accordion', 'reveal', 'citations'] satisfies CardNode['type'][]);

const isContent = (n: CardNode) => n.type !== 'actions' && n.type !== 'citations';

/** Streams a designed card from a single call: header first, then each grounded top-level node as soon as it is written. */
export async function designStream(req: DesignRequest, env: Env, on: DesignEvents): Promise<DesignSummary> {
  const imageCount = Math.min(req.search.images.length, 12);
  if (!hasDeepSeek(env)) return extractive(req, on);

  const g = new Grounding(corpusOf(req));
  const base = req.followup?.mode === 'refine' && req.followup.baseCard ? `CURRENT CARD\n${JSON.stringify(req.followup.baseCard).slice(0, 12000)}\n\n` : '';
  const user = `${sourcesBlock(req.search, req.pages)}\n\n${base}SKELETON\n${JSON.stringify(patternById(req.pattern).skeleton)}\n\nTASK\n${taskBlock(req)}\n\nQUERY: ${req.followup?.question ?? req.query}`;

  let headSent = false;
  let index = 0;
  let contentNodes = 0;
  let removed = 0;
  try {
    await deepseekLines(env, SYSTEM_WHOLE, user, 2800, (line) => {
      const parsed = parseLine(line, g, imageCount, req.query);
      if (!parsed) return;
      switch (parsed.kind) {
        case 'followups':
          return on.followups(parsed.items);
        case 'head':
          if (headSent) return;
          headSent = true;
          return on.head(parsed.head);
        case 'node':
          if (isContent(parsed.node)) contentNodes++;
          return on.node(parsed.node, index++);
        case 'dropped':
          removed++;
          return;
        default: {
          const unreachable: never = parsed;
          return unreachable;
        }
      }
    });
  } catch (err) {
    console.error('DeepSeek stream failed', err);
  }
  if (!contentNodes) return extractive(req, on);
  return { engine: 'deepseek', removed };
}

/** Plain-language summary of what a skeleton region is for, from its slot hints. */
function regionPurpose(node: CardNode): string {
  const hints: string[] = [];
  const walk = (n: CardNode) => {
    if (n.type === 'slot') hints.push(n.hint);
    if ('children' in n) n.children.forEach(walk);
  };
  walk(node);
  return [...new Set(hints)].join(' + ') || node.type;
}

/** Finish-call nodes go after the regions: interactive control, then actions, then citations. */
const FINISH_ORDER: Partial<Record<CardNode['type'], number>> = { choices: 0, slider: 0, scaler: 0, accordion: 0, reveal: 0, actions: 1, citations: 2 };
const FINISH_SLOTS = 3;

/**
 * Designs each top-level region of the skeleton in its own concurrent call, plus
 * one call for the header, an interactive control, actions, citations and
 * follow-ups. Regions fill their placeholders as soon as they are ready, so the
 * card completes in roughly the time of its slowest region.
 */
export async function designParallel(req: DesignRequest, env: Env, on: DesignEvents): Promise<DesignSummary> {
  const imageCount = Math.min(req.search.images.length, 12);
  if (!hasDeepSeek(env)) return extractive(req, on);

  const regions = patternById(req.pattern).skeleton;
  on.layout(regions);
  const g = new Grounding(corpusOf(req));
  const shared = `${sourcesBlock(req.search, req.pages, 2000)}\n\nTASK\n${taskBlock(req)}\n- Card regions, top to bottom:\n${regions.map((r, i) => `  R${i + 1}: ${regionPurpose(r)}`).join('\n')}\n  FINISH: header, interactive control, actions, citations, follow-ups`;
  const query = req.followup?.question ?? req.query;

  let contentNodes = 0;
  let removed = 0;

  const regionCall = (region: CardNode, i: number) => {
    const user = `${shared}\n- YOU DESIGN R${i + 1}: ${JSON.stringify(region)}. Replace its slots with real components; you may reshape it (a stack or grid can hold several components) but keep to this region's purpose.${i === 0 ? ' R1 is the lead: it must answer the question at a glance.' : ''}\n- Output exactly one line: one JSON node.\n\nQUERY: ${query}`;
    let done = false;
    return deepseekLines(env, SYSTEM_REGION, user, 1200, (line) => {
      if (done) return;
      const parsed = parseLine(line, g, imageCount, req.query);
      if (parsed?.kind === 'node') {
        done = true;
        contentNodes++;
        on.node(parsed.node, i);
      } else if (parsed?.kind === 'dropped') removed++;
    });
  };

  const finishCall = () => {
    const user = `${shared}\n- YOU DESIGN FINISH. Output these lines:\n  1. {"title":string,"subtitle":string,"icon":string,"accent":tone} for the whole card\n  2. only if the answer has something worth adjusting, exploring or testing: one interactive node such as {"type":"choices",...} or {"type":"slider",...} that the regions above don't already cover\n  3. {"type":"actions","items":[...]} with 2-4 useful next steps (prefer kind "refine" for changes to this card)\n  4. {"type":"citations","refs":[...]} with the source numbers that matter most\n  5. {"followups":[4 short follow-up questions]}\n\nQUERY: ${query}`;
    let headSent = false;
    let extra = 0;
    return deepseekLines(env, SYSTEM_REGION, user, 1000, (line) => {
      const parsed = parseLine(line, g, imageCount, req.query);
      if (!parsed) return;
      switch (parsed.kind) {
        case 'head':
          if (!headSent) on.head(parsed.head);
          headSent = true;
          return;
        case 'followups':
          return on.followups(parsed.items);
        case 'node': {
          if (parsed.node.type === 'heading' && !headSent) {
            headSent = true;
            return on.head({ title: parsed.node.text, subtitle: parsed.node.eyebrow });
          }
          const order = FINISH_ORDER[parsed.node.type];
          return on.node(parsed.node, order === undefined ? regions.length + FINISH_SLOTS + extra++ : regions.length + order);
        }
        case 'dropped':
          removed++;
          return;
        default: {
          const unreachable: never = parsed;
          return unreachable;
        }
      }
    });
  };

  const results = await Promise.allSettled([...regions.map(regionCall), finishCall()]);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error('region failed', (r as PromiseRejectedResult).reason));
  if (!contentNodes) return extractive(req, on);
  return { engine: 'deepseek', removed };
}

/** Builds a card straight from snippet sentences when no generator is available. */
function extractive(req: DesignRequest, on: DesignEvents): DesignSummary {
  const { search, pattern: patternId, query } = req;
  const cands = candidates(search);
  const stats = extractStats(cands, 4);
  const timeline = extractTimeline(cands);
  const k = search.knowledge;
  const imageRef = k?.image ? search.images.findIndex((img) => img.thumb === k.image) : -1;
  const body: CardNode[] = [];

  if (k && ['profile', 'visual', 'explainer', 'answer'].includes(patternId)) {
    body.push({ type: 'profile', name: k.title, subtitle: k.description, imageRef: imageRef >= 0 ? imageRef : undefined });
  }
  if (cands[0]) body.push({ type: 'text', text: cands[0].text, size: 'lg' });
  if (stats.length >= 2) body.push({ type: 'grid', cols: 2, children: stats.map((s) => ({ type: 'stat', label: clip(s.label, 60), value: s.value })) });
  if (timeline.length >= 3) body.push({ type: 'timeline', items: timeline.map((t) => ({ when: t.when, title: t.text })) });
  if (search.images.length >= 3 && ['visual', 'profile', 'spotlight'].includes(patternId)) body.push({ type: 'gallery', refs: [0, 1, 2, 3, 4, 5].filter((i) => i < search.images.length) });
  if (cands.length > 1) body.push({ type: 'section', title: 'Key points', icon: 'pin', children: [{ type: 'list', style: 'check', items: cands.slice(1, 6).map((c) => ({ text: c.text, meta: c.domain })) }] });
  body.push({ type: 'citations', refs: [1, 2, 3, 4].filter((i) => i <= search.results.length) });

  on.head({ title: k?.title ?? query, subtitle: patternById(patternId).label });
  body.forEach((node, i) => on.node(node, i));
  return { engine: 'extractive', removed: 0 };
}
