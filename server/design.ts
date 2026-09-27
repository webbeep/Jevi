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
- tile {label, value, sub, icon, active:boolean}  (compact cell for scrollers and grids)
- keyvalue {items:[{label, value, icon}]}
- list {style:"bullet"|"check"|"number"|"icon", items:[{text, icon, meta}]}
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
  brief: 'Keep it to a glance: 3-5 top-level nodes.',
  standard: 'Aim for 4-7 top-level nodes.',
  detailed: 'Be thorough: 6-10 top-level nodes, using tabs or sections to stay tidy.',
} as const;

function sourcesBlock(search: SearchResponse, pages: PageText[]): string {
  const results = search.results.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title} (${r.domain}${r.date ? `, ${r.date}` : ''}): ${clip(r.snippet, 420)}`);
  const pageBlock = pages.length ? `\n\nPAGE TEXT (readable content of some sources, cite with the same number)\n${pages.map((p) => `[${p.n}] ${clip(p.text, 2800)}`).join('\n\n')}` : '';
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
}

export interface DesignEvents {
  head: (head: Omit<AnswerCard, 'body'>) => void;
  node: (node: CardNode) => void;
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

/** Identical for every request so the provider can cache it; per-request details go in the user message. */
const SYSTEM_PROMPT = `You are the UI designer of a visual search engine. For every query you design one answer card, like a purpose-built app screen for exactly this answer: think about what a person expects to see and how a dedicated app would present it (a live reading gets a huge hero number with a swipeable series of tiles; a recipe gets time and servings tiles then numbered steps; a comparison gets a table and a verdict). Compose the card from the grammar below, choosing the components and arrangement that make the answer instantly readable.

${GRAMMAR}

RULES
- Start from the SKELETON layout given in the TASK. Replace every slot with real components; you may add, drop or rearrange nodes if it serves the answer better.
- Every number, value and fact must come from SOURCES or PAGE TEXT. Never estimate, never use typical or example values, never fill a slot from general knowledge. Any number not found in the sources is automatically deleted, so leave such nodes out.
- Never compute new numbers yourself (multiplying, converting, summing). When quantities should change with an amount (servings, loaves, people, budget), use a scaler node whose base and amounts are exactly the source values; the person rescales it live.
- If the sources don't contain what the person asked for (for example a live reading or a price), say so honestly in a short callout and make the actions node point to the best sources to check.
- Put citations like [2] inside text nodes where useful. Lead with the answer: the first body node must already be useful on its own. Prefer visual components (hero, tiles, stats, charts, tables, timelines) over paragraphs; keep text short.
- Nesting depth at most 4.
- Include at least one interactive node (choices, slider, scaler, accordion or reveal) whenever the answer has something worth adjusting, exploring or testing.
- Finish with an actions node (2-4 useful next steps; prefer "refine" for changes to this card) and a citations node.

OUTPUT FORMAT — JSON Lines, streamed to the screen as you write:
Line 1: {"title":string,"subtitle":string,"icon":string,"accent":tone}
Then exactly one line per top-level body node, each a complete compact JSON object (children nested inside it).
Last line: {"followups":[4 short follow-up questions]}
No code fences, no prose, no blank lines, no line breaks inside a JSON object.`;

function taskBlock(req: DesignRequest): string {
  const pattern = patternById(req.pattern);
  return [
    `- Pre-selected layout: "${pattern.label}" (${pattern.description}).`,
    `- ${DEPTH_HINT[req.depth]}`,
    req.simple ? '- Write for a 10-year-old: plain words and a friendly analogy.' : '',
    followupRules(req.followup, req.search.query).trim().replace(/^/, '- '),
  ]
    .filter((l) => l && l !== '- ')
    .join('\n');
}

/** Streams a designed card: header first, then each grounded top-level node as soon as it is written. */
export async function designStream(req: DesignRequest, env: Env, on: DesignEvents): Promise<DesignSummary> {
  const imageCount = Math.min(req.search.images.length, 12);
  if (!hasDeepSeek(env)) return extractive(req, on);

  const corpus = [
    req.query,
    req.followup?.question ?? '',
    req.followup?.baseCard ? JSON.stringify(req.followup.baseCard) : '',
    ...req.search.results.map((r) => `${r.title} ${r.snippet} ${r.date ?? ''}`),
    req.search.knowledge?.extract ?? '',
    ...req.pages.map((p) => p.text),
  ].join(' ');
  const g = new Grounding(corpus);
  const base = req.followup?.mode === 'refine' && req.followup.baseCard ? `CURRENT CARD\n${JSON.stringify(req.followup.baseCard).slice(0, 12000)}\n\n` : '';
  const user = `TASK\n${taskBlock(req)}\n\nQUERY: ${req.followup?.question ?? req.query}\n\n${base}SKELETON\n${JSON.stringify(patternById(req.pattern).skeleton)}\n\n${sourcesBlock(req.search, req.pages)}`;

  let headSent = false;
  let contentNodes = 0;
  let removed = 0;
  try {
    await deepseekLines(env, SYSTEM_PROMPT, user, 2800, (line) => {
      const json = line.replace(/^```(?:json)?|```$/g, '').replace(/,$/, '').trim();
      if (!json.startsWith('{')) return;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(json) as Record<string, unknown>;
      } catch {
        return;
      }
      if (Array.isArray(obj.followups)) {
        on.followups(obj.followups.filter((f): f is string => typeof f === 'string').slice(0, 4));
      } else if (!headSent && !('type' in obj)) {
        const head = sanitizeCard({ ...obj, body: [] }, imageCount, req.query);
        headSent = true;
        on.head({ title: head.title, subtitle: head.subtitle && g.ok(head.subtitle) ? head.subtitle : undefined, icon: head.icon, accent: head.accent });
      } else if ('type' in obj) {
        const [clean] = sanitizeNodes([obj], imageCount);
        const [grounded] = clean ? groundNodes([clean], g) : [];
        if (!grounded) {
          removed++;
          return;
        }
        if (grounded.type !== 'actions' && grounded.type !== 'citations') contentNodes++;
        on.node(grounded);
      }
    });
  } catch (err) {
    console.error('DeepSeek stream failed', err);
    if (!contentNodes) return extractive(req, on);
  }
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
  body.forEach(on.node);
  return { engine: 'extractive', removed: 0 };
}
