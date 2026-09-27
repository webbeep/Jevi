import type { AnswerCard, CardNode, CardResponse, FollowupContext, FollowupMode, LayoutPlan } from '../shared/card';
import type { SearchResponse } from '../shared/types';
import { deepseekJson, hasDeepSeek } from './deepseek';
import { candidates, extractStats, extractTimeline } from './extract';
import { groundCard } from './ground';
import { askJev, choice, jevKey, noul, score } from './jev';
import { type PageText, readTopPages } from './pages';
import { PATTERNS, heuristicPattern, patternById, skeletonCard } from './patterns';
import { sanitizeCard } from './sanitize';
import { Env, clip } from './util';

const DEPTHS = ['brief', 'standard', 'detailed'] as const;

const MODES: Record<FollowupMode, string> = {
  refine: 'Changes how the current answer card is shown: a different unit, time range, focus, audience, amount or level of detail, on the same topic',
  answer: 'A new question about the same topic that the current search results can probably answer',
  search: 'A different topic, or something the current results cannot cover, so a fresh web search is needed',
};

export async function planLayout(query: string, env: Env, original?: string, cards: { id: number; title: string }[] = []): Promise<LayoutPlan> {
  const started = Date.now();
  const fallback = (): LayoutPlan => {
    const pattern = heuristicPattern(query);
    return {
      query,
      pattern,
      alternatives: [patternById(pattern), ...PATTERNS.filter((p) => p.id !== pattern).slice(0, 2)].map(({ id, label, description }) => ({ id, label, description })),
      skeleton: skeletonCard(query, pattern),
      engine: 'heuristic',
      confidence: 0.5,
      depth: 'standard',
      readPages: heuristicPattern(query) === 'spotlight' || heuristicPattern(query) === 'dataset',
      mode: original ? 'answer' : undefined,
      ms: Date.now() - started,
    };
  };
  if (!jevKey(env)) return fallback();

  try {
    const state = original
      ? `Someone searched for "${original}" and is looking at the answer card. They now typed the follow-up: "${query}". Decide how the answer to this follow-up should be laid out.`
      : `Someone typed this into a search engine: "${query}". Before any results load, decide how the answer card should be laid out so the answer is instantly readable at a glance.`;
    const answers = await askJev(env, state, {
      ...(original ? { mode: { type: 'choice' as const, instructions: 'What kind of follow-up is this?', criteria: MODES } } : {}),
      ...(original && cards.length > 1
        ? { target: { type: 'choice' as const, instructions: 'If this asks to change a card on screen, which card does it refer to?', criteria: Object.fromEntries(cards.slice(-8).map((c) => [`c${c.id}`, c.title])) } }
        : {}),
      pattern: {
        type: 'choice',
        instructions: 'Which card layout fits the answer this person expects?',
        criteria: Object.fromEntries(PATTERNS.map((p) => [p.id, p.description])),
      },
      depth: {
        type: 'score',
        instructions: 'How much detail does the person want?',
        criteria: ['A glance is enough', 'A normal amount of detail', 'A thorough, detailed answer'],
      },
      needs_pages: {
        type: 'noul',
        instructions: 'A good answer needs precise figures, current readings, specs, prices or step details that short search-result snippets usually leave out.',
      },
    });
    const pick = choice(answers, 'pattern');
    if (!pick) return fallback();
    const ranked = Object.entries(pick.probabilities).sort((a, b) => b[1] - a[1]).map(([id]) => patternById(id));
    const depthScore = score(answers, 'depth') ?? 1;
    return {
      query,
      pattern: pick.choice,
      alternatives: ranked.slice(0, 3).map(({ id, label, description }) => ({ id, label, description })),
      skeleton: skeletonCard(query, pick.choice),
      engine: 'jev',
      confidence: pick.confidence,
      depth: DEPTHS[Math.max(0, Math.min(2, Math.round(depthScore)))],
      readPages: noul(answers, 'needs_pages') >= 0.5,
      mode: original ? ((choice(answers, 'mode')?.choice as FollowupMode | undefined) ?? 'answer') : undefined,
      target: Number(choice(answers, 'target')?.choice.slice(1)) || undefined,
      ms: Date.now() - started,
    };
  } catch (err) {
    console.error('Jev plan failed', err);
    return fallback();
  }
}

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
  const pageBlock = pages.length ? `\n\nPAGE TEXT (full text of some sources, cite with the same number)\n${pages.map((p) => `[${p.n}] ${p.text}`).join('\n\n')}` : '';
  const knowledge = search.knowledge ? `\nEncyclopedia (${search.knowledge.url}): ${search.knowledge.title} — ${clip(search.knowledge.extract, 900)}` : '';
  const images = search.images.slice(0, 12).map((img, i) => `${i}: ${img.title || img.source}`);
  return `SOURCES\n${results.join('\n')}${knowledge}${pageBlock}\n\nIMAGES (use by index)\n${images.join('\n') || 'none'}`;
}

export interface DesignRequest {
  query: string;
  pattern: string;
  depth: LayoutPlan['depth'];
  readPages?: boolean;
  search: SearchResponse;
  simple?: boolean;
  followup?: FollowupContext;
}

function followupRules(f: FollowupContext | undefined, originalQuery: string): string {
  if (!f) return '';
  switch (f.mode) {
    case 'refine':
      return `\n\nTHIS IS A REDESIGN. The person is looking at CURRENT CARD (below) for "${originalQuery}" and asked: "${f.question}". Return the full updated card: apply the change, keep what still applies, and restructure freely if the change calls for a different layout. Mark the matching choices option as selected and move any slider to the requested value.`;
    case 'answer':
      return `\n\nTHIS IS A FOLLOW-UP. The original search was "${originalQuery}". Design a focused card that answers only the follow-up question "${f.question}". Do not repeat the original answer; pick the components that fit this question best.`;
    default: {
      const unreachable: never = f.mode;
      return unreachable;
    }
  }
}

export async function designCard(req: DesignRequest, env: Env): Promise<CardResponse> {
  const started = Date.now();
  const extractive = () => ({ ...extractiveCard(req.query, req.pattern, req.search), pagesRead: 0, removed: 0, ms: Date.now() - started });
  if (!hasDeepSeek(env)) return extractive();

  const pages = req.readPages ? await readTopPages(req.search.results) : [];
  const pattern = patternById(req.pattern);
  const system = `You are the UI designer of a visual search engine. For every query you design one answer card, like a purpose-built app screen for exactly this answer: think about what a person expects to see and how a dedicated app would present it (a live reading gets a huge hero number with a swipeable series of tiles; a recipe gets time and servings tiles then numbered steps; a comparison gets a table and a verdict). Compose the card from the grammar below, choosing the components and arrangement that make the answer instantly readable.

${GRAMMAR}

RULES
- Start from the SKELETON layout that was pre-selected ("${pattern.label}": ${pattern.description}). Replace every slot with real components; you may add, drop or rearrange nodes if it serves the answer better.
- Every number, value and fact must come from SOURCES or PAGE TEXT. Never estimate, never use typical or example values, never fill a slot from general knowledge. Any number not found in the sources is automatically deleted, so leave such nodes out.
- Never compute new numbers yourself (multiplying, converting, summing). When quantities should change with an amount (servings, loaves, people, budget), use a scaler node whose base and amounts are exactly the source values; the person rescales it live.
- If the sources don't contain what the person asked for (for example a live reading or a price), say so honestly in a short callout and make the actions node point to the best sources to check.
- Put citations like [2] inside text nodes where useful. Lead with the answer. Prefer visual components (hero, tiles, stats, charts, tables, timelines) over paragraphs; keep text short.
- Nesting depth at most 4. ${DEPTH_HINT[req.depth]}
- Include at least one interactive node (choices, slider, scaler, accordion or reveal) whenever the answer has something worth adjusting, exploring or testing.
- Finish with an actions node (2-4 useful next steps; prefer "refine" for changes to this card) and a citations node.${req.simple ? '\n- Write for a 10-year-old: plain words and a friendly analogy.' : ''}${followupRules(req.followup, req.search.query)}

Reply with JSON only: {"card":{"title":string,"subtitle":string,"icon":string,"accent":tone,"body":[nodes]},"followups":[4 short follow-up questions]}`;

  const base = req.followup?.mode === 'refine' && req.followup.baseCard ? `CURRENT CARD\n${JSON.stringify(req.followup.baseCard).slice(0, 12000)}\n\n` : '';
  const user = `QUERY: ${req.followup?.question ?? req.query}\n\n${base}SKELETON\n${JSON.stringify(pattern.skeleton)}\n\n${sourcesBlock(req.search, pages)}`;
  try {
    const out = await deepseekJson<{ card?: unknown; followups?: unknown }>(env, system, user, 2600);
    const sanitized = sanitizeCard(out.card, Math.min(req.search.images.length, 12), req.query);
    const corpus = [req.query, req.followup?.question ?? '', req.followup?.baseCard ? JSON.stringify(req.followup.baseCard) : '', ...req.search.results.map((r) => `${r.title} ${r.snippet} ${r.date ?? ''}`), req.search.knowledge?.extract ?? '', ...pages.map((p) => p.text)].join(' ');
    const { card, removed } = groundCard(sanitized, corpus);
    if (!card.body.some((n) => n.type !== 'actions' && n.type !== 'citations')) throw new Error('card had no grounded content');
    const followups = Array.isArray(out.followups) ? out.followups.filter((f): f is string => typeof f === 'string').slice(0, 4) : [];
    return { card, followups, engine: 'deepseek', pagesRead: pages.length, removed, ms: Date.now() - started };
  } catch (err) {
    console.error('DeepSeek design failed', err);
    return extractive();
  }
}

/** Builds a card straight from snippet sentences when no generator is available. */
function extractiveCard(query: string, patternId: string, search: SearchResponse): Pick<CardResponse, 'card' | 'followups' | 'engine'> {
  const cands = candidates(search);
  const stats = extractStats(cands, 4);
  const timeline = extractTimeline(cands);
  const body: CardNode[] = [];
  const k = search.knowledge;
  const imageRef = k?.image ? search.images.findIndex((img) => img.thumb === k.image) : -1;

  if (k && ['profile', 'visual', 'explainer', 'answer'].includes(patternId)) {
    body.push({ type: 'profile', name: k.title, subtitle: k.description, imageRef: imageRef >= 0 ? imageRef : undefined });
  }
  if (cands[0]) body.push({ type: 'text', text: cands[0].text, size: 'lg' });
  if (stats.length >= 2) body.push({ type: 'grid', cols: 2, children: stats.map((s) => ({ type: 'stat', label: clip(s.label, 60), value: s.value })) });
  if (timeline.length >= 3) body.push({ type: 'timeline', items: timeline.map((t) => ({ when: t.when, title: t.text })) });
  if (search.images.length >= 3 && ['visual', 'profile', 'spotlight'].includes(patternId)) body.push({ type: 'gallery', refs: [0, 1, 2, 3, 4, 5].filter((i) => i < search.images.length) });
  if (cands.length > 1) body.push({ type: 'section', title: 'Key points', icon: 'pin', children: [{ type: 'list', style: 'check', items: cands.slice(1, 6).map((c) => ({ text: c.text, meta: c.domain })) }] });
  body.push({ type: 'citations', refs: [1, 2, 3, 4].filter((i) => i <= search.results.length) });

  const card: AnswerCard = { title: k?.title ?? query, subtitle: patternById(patternId).label, body };
  return { card, followups: [], engine: 'extractive' };
}
