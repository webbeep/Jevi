import type { AnswerCard, CardNode, FollowupContext, ImageCredit, LayoutPlan } from '../shared/card';
import { knowledgeMatches } from '../shared/relevance';
import type { SearchResponse } from '../shared/types';
import { hasLlm, llmLines } from './llm';
import { candidates, extractStats, extractTimeline } from './extract';
import { Grounding, groundNodes } from './ground';
import { PictureResolver, type RowImagePlan } from './pictures';
import { Polisher } from './polish';
import type { PageText } from './pages';
import { patternById } from './patterns';
import { sanitizeCard, sanitizeNodes, type PriceSource } from './sanitize';
import { stampOfficialPriceCite } from '../shared/vendorPrice';
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
- tile {label, value, sub, icon, imageQuery, imageRef, active:boolean, source}  (compact cell for scrollers and grids; with a picture it becomes a picture tile, great for products, places, dishes, people)
- keyvalue {items:[{label, value, icon}]}
- list {style:"bullet"|"check"|"number"|"icon"|"media", items:[{text, icon, meta, imageQuery, imageRef, source}]}  ("media" shows each item as a row with its own thumbnail; meta is a short badge like a price or score)
- links {items:[{source, label, note}]}  (pages, videos, channels, tools or official sites to open — each is a SOURCES number; label is a short name for it, note says what it is: "Official site", "Video · 12 min", "Live coverage")
- video {source, caption}  (a VIDEO source, playable in place; use it when watching beats reading — tutorials, highlights, trailers, talks)
LINKS: anything the person will want to open (an article, video, product page, booking or official site) carries "source": its SOURCES number, on a tile, list item or links item. Never write raw URLs.
- chart {kind:"bar"|"hbar"|"line"|"area"|"pie", title, unit, data:[{label, value:number}]}  (bar: compare categories; hbar: rankings with long names; line/area: change over time; pie: shares of a whole)
- progress {label, value:0-100, caption}
- rating {value, max, label}
- table {columns:[string], rows:[[string]], highlight:column index}
- timeline {items:[{when, title, text, source}]}
- steps {items:[{title, detail}]}
- proscons {pros:[string], cons:[string]}
- badges {items:[string]}
- quote {text, source}
- callout {tone, title, text, icon}
- draft {label, text}  (a finished piece of writing the person asked for — email, message, post, letter, bio, cover letter — shown as a document with a copy button; label names it, e.g. "Email to landlord"; use \\n for line breaks)
- code {lang, code}  (a complete, runnable code snippet with a copy button; lang like "python", "sql", "bash")
- image {query | ref, caption, aspect:"wide"|"square"|"tall"}
- gallery {query | refs}  (several real photos of one subject)
- profile {name, subtitle, imageQuery | imageRef, facts:[{label, value}]}
PICTURES: imageQuery / query is the exact name of what the picture must show ("Nike Downshifter 13", "Eiffel Tower at night", "Taylor Swift"); a real photo of that exact item is found for it. imageRef / ref is an IMAGES index — use it only when that image's description clearly shows the same item. Never use an IMAGES index for an item when the image's description names another item or says vs/compare; give each item its own imageQuery instead.
- actions {items:[{label, icon, query, kind:"search"|"ask"|"refine"}]}  (next-step buttons, each opens a NEW card below: "refine" = this card with a change, query is the instruction; "ask" = answers a follow-up question; "search" = new web search, query is a complete search query. Every query must stand alone and name the subject: "Gluten-free apple pie crust", never "gluten-free" or "apples")
- citations {refs:[source numbers]}
INTERACTIVE (make the card something to play with, not just read)
- choices {label, options:[{label, prompt, selected}]}  (segmented control; picking an option opens a new card adjusted by its prompt, e.g. time range, focus, audience. The prompt names the subject: "Show the apple pie recipe for a vegan diet")
- slider {label, min, max, step, value, unit, prompt}  (prompt must contain {value} and name the subject; releasing the slider opens a new adjusted card, e.g. "Plan the Tokyo trip for {value} people")
- scaler {label, base, value, min, max, step, unit, items:[{name, amount:number, unit}]}  (live, instant rescaling of quantities such as ingredients or costs; base is the amount the sources describe, value is where the control starts, e.g. the amount the person asked for)
- pricing {label, seats, billing:"monthly"|"annual", plans:[{name, prices:[{amount, currency:"USD", unit:"seat"|"flat", period:"month"|"year", billing:"monthly"|"annual", minSeats, includedSeats, source}]}]}  (plan or subscription prices. amount is the published figure only — per seat, or a flat tier — never a team total. source is the SOURCES number of the page that states that exact price. billing is "annual" when that page says billed annually or yearly, even if the figure is quoted per month; "monthly" only for month-to-month. Give both prices when both are published. seats is the team size asked about. The card multiplies seats × price locally and toggles billing with no new search. Do not repeat any dollar amount outside this node.)
- accordion {items:[{title, text}]}  (tap to expand details)
- reveal {items:[{front, back}]}  (tap-to-flip cards for quizzes, myths vs facts, terms)
icon: any lucide icon name in kebab-case, e.g. "thermometer", "map-pin", "clock", "trending-up".
tone: "default"|"muted"|"primary"|"positive"|"negative"|"warning".`;

const DEPTH_HINT = {
  brief: 'Keep it to a glance: 3-4 top-level nodes, almost no prose.',
  standard: 'Aim for 4-6 top-level nodes.',
  detailed: 'Be thorough but tidy: up to 8 top-level nodes, grouping extra detail into tabs or accordions.',
} as const;

/** Watch pages that play in place (channels and playlists are ordinary links). */
const isVideo = (url: string) => /(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/|vimeo\.com\/\d)/.test(url);

function sourcesBlock(search: SearchResponse, pages: PageText[], pageChars = 2800): string {
  const results = search.results.slice(0, 12).map((r, i) => `[${i + 1}] ${isVideo(r.url) ? 'VIDEO ' : ''}${r.title} (${r.domain}${r.date ? `, ${r.date}` : ''}): ${clip(r.snippet, 420)}`);
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
  /** Reason step by step before designing (slower, for hard questions). */
  think?: boolean;
  /** What the person actually wants, read from the query before searching. */
  intent?: string;
  /** T442: fill pictures on tiles and media rows the designer left blank. */
  rowImages?: RowImagePlan;
}

export interface DesignEvents {
  /** The model started reasoning (only when `think` is set). */
  thinking?: () => void;
  /** Placeholder regions that indexed nodes will fill (parallel design only). */
  layout: (regions: CardNode[]) => void;
  head: (head: Omit<AnswerCard, 'body'>) => void;
  /** `index` is the node's position in the card; parallel regions may arrive out of order. */
  node: (node: CardNode, index: number) => void;
  followups: (items: string[]) => void;
  /** Attribution for a picture placed on the card. */
  credit: (credit: ImageCredit) => void;
}

export interface DesignSummary {
  /** 'reasoning' marks answers built from thinking and general knowledge rather than sources. */
  engine: 'composed' | 'reasoning' | 'extractive';
  removed: number;
  via?: string;
}

function followupRules(f: FollowupContext | undefined, originalQuery: string): string {
  if (!f) return '';
  switch (f.mode) {
    case 'refine':
      return `\n\nTHIS IS AN ADJUSTED VERSION of CURRENT CARD (below), which answered "${originalQuery}". The person asked: "${f.question}". Output a complete new card that applies the change: keep the same subject and everything that still applies, restructure freely if the change calls for a different layout, and make the change obvious in the subtitle. Mark the matching choices option as selected and move any slider or scaler to the requested value. The original card stays on screen above, so do not describe what changed in prose.`;
    case 'answer':
      return `\n\nTHIS IS A FOLLOW-UP. The original search was "${originalQuery}". Design a focused card that answers only the follow-up question "${f.question}". Do not repeat the original answer; pick the components that fit this question best.`;
    case 'chat':
      return `\n\nTHIS IS A CONVERSATION TURN, NOT A SEARCH. Reply to "${f.question}" like a thoughtful expert assistant: understand what they really need given the conversation, think it through, and give a direct, confident answer first, then the reasoning or steps that support it. Use the conversation, your general knowledge and the SOURCES where relevant. You may reason, calculate, compare, plan and advise here. Do not invent current specifics (today's prices, recent events, live figures, exact specs you are unsure of); when those matter, say what to check and add a "search" action for it. Only cite [n] when a statement really comes from that source.`;
    default: {
      const unreachable: never = f.mode;
      return unreachable;
    }
  }
}

const DESIGNER = `You are the UI designer of an assistant that both searches the web and thinks. Every message gets one answer card, like a purpose-built app screen for exactly this answer: think about what a person expects to see and how a dedicated app would present it (a live reading gets a huge hero number with a swipeable series of tiles; a recipe gets time and servings tiles then numbered steps; a comparison gets a table and a verdict). Compose from the grammar below, choosing the components and arrangement that make the answer instantly readable.

${GRAMMAR}

STYLE — visual first, minimal text
- Show, don't tell: numbers, icons, pictures, charts, tables and timelines carry the answer; words only label them. The card should be understood in a 3-second glance.
- Never restate the card title as a heading; the header already shows it.
- If the sources only support a few facts, make the card shorter: drop any skeleton slot you cannot fill with new information instead of rephrasing something already shown.
- Text budget: labels 1-4 words; tile and stat values as short as possible; subtitles under 10 words; a text node is 1-2 short sentences. Never repeat the same fact in two places. No filler ("Here is", "In summary", "It is important to note").
- When the person wants to understand something (why/how/what is, or an explainer layout), explanation is the content: use clear, plain sentences in short paragraphs or an accordion, keep every step of the reasoning (don't skip what a newcomer needs), and add a one-line analogy. Still concise.
- Predict what they will want next: offer the 1-3 most likely adjustments as controls (choices, slider, scaler) or "refine" actions — e.g. a different budget, size, date range, audience or level of detail — so they never have to type a clarification.
- Pictures: every picture must show the specific item it sits next to — each product, place, dish or person gets its own imageQuery with its exact name. Use pictures where seeing the item helps (products, places, food, people, animals, landmarks, designs); skip them for abstract topics. Never reuse one picture for several items and never use a general stock-style photo. Never use an IMAGES index for an item when the image's description names another item or says vs/compare; give each item its own imageQuery instead.
- Charts and tables only when they add understanding: a chart needs 3+ comparable numbers from the sources (a trend, a ranking, shares of a whole); a table needs 2+ items compared across 3+ attributes. Never chart two numbers or non-numeric facts; a stat or tile is better there.

FIT THE KIND OF REQUEST
- Quick fact (who, when, how tall, what time, define a word): the answer in a hero or one sentence, a line of context, and little else — 2-3 nodes.
- How-to or recipe: time, difficulty or servings tiles, what you need, numbered steps, then one tip.
- Best X / what to buy: the verdict first, then a media list of picks — each with its own picture and a price or score badge — then what to look for.
- X vs Y: a table across the attributes that matter and a one-line verdict on who should pick which. When the comparison is priced plans or tools, a pricing node carries each plan's published price.
- Best tool / which plan / what it costs for a team: a pricing node, one row per plan. Do not put the team total in a hero, stat, tile or table.
- Person, place, company or product: profile with picture and key facts, then a short background.
- News or anything recent: the latest development first with its date; date every item; cite each one and link each story to its source.
- Wants to watch, listen or go somewhere (videos, tutorials, channels, tools, booking, official sites): put the destinations first as video or links nodes, then a short summary. If they ask for a video or tutorial and a VIDEO source fits, the card opens with one video node.
- Health, medical, legal, money or safety: give the useful answer plainly, then one short callout on when to see a professional. Never alarmist, never refuse a general question.
- Writing for them (email, message, post, letter, rewrite): one complete draft node first, ready to send — no placeholders like [Name] unless the detail is truly unknown — then choices for tone or length.
- Code: a complete, runnable code node first, then a short explanation of the key lines and how to run it.
- Plans (trip, workout, study, meals): key numbers as tiles, then the plan in tabs by day or phase.

HEADER
- title: 2-6 words, at most 40 characters, naming the subject like an app screen title ("Apple Pie Recipe", "Tokyo in 3 Days") — never a question or a full sentence.
- subtitle: at most 8 words of useful context (what kind of answer, for whom, or how fresh), never a repeat of the title.

RULES
- Every number, value and fact must come from SOURCES or PAGE TEXT. Never estimate, never use typical or example values, never fill a slot from general knowledge. Any number not found in the sources is automatically deleted, so leave such nodes out.
- Never compute new numbers yourself (multiplying, converting, summing). When quantities should change with an amount (servings, loaves, people, budget), use a scaler node whose base and amounts are exactly the source values; the person rescales it live.
- Plan and subscription prices always go in a pricing node, as the published per-seat or flat amount with its source number. Set billing to annual when the source says billed annually, even if the number is per month. Never multiply by people or seats, and never write a dollar amount or team total anywhere else on the card. If the sources do not state a price, leave that amount out.
- If the sources don't contain what the person asked for (for example a live reading or a price), say so honestly in a short callout and point to the best sources to check.
- Put citations like [2] inside text nodes where useful. Prefer visual components (hero, tiles, stats, charts, tables, timelines) over paragraphs; keep text short.
- Nesting depth at most 4.`;

/** Both system prompts are identical across requests so the provider can cache them. */
const SYSTEM_WHOLE = `${DESIGNER}
- Start from the SKELETON layout given in the TASK. Replace every slot with real components; you may add, drop or rearrange nodes if it serves the answer better.
- Lead with the answer: the first body node must be small and already useful on its own (a hero or a one-sentence answer), so it appears on screen immediately.
- Include at least one interactive node (choices, slider, scaler, pricing, accordion or reveal) whenever the answer has something worth adjusting, exploring or testing. For plan prices, the interactive node is pricing.
- Finish with an actions node (2-4 useful next steps; prefer "refine" for changes to this card) and a citations node when sources were used.

OUTPUT FORMAT — JSON Lines, streamed to the screen as you write:
Line 1: {"title":string,"subtitle":string,"icon":string,"accent":tone}
Then exactly one line per top-level body node, each a complete compact JSON object (children nested inside it).
Last line: {"followups":[4 short follow-up questions, each naming the subject, e.g. "How long does apple pie keep?" not "How long does it keep?"]}
No code fences, no prose, no blank lines, no line breaks inside a JSON object.`;

const SYSTEM_REGION = `${DESIGNER}
- You are one of several designers building the same card in parallel. The TASK tells you which part is yours and what the others cover; stay in your lane and never repeat their content. If your region is a list of items (picks, options, places), it holds the whole list.
- Output only what the TASK asks for, as JSON Lines: one complete compact JSON object per line. Every node carries a \"type\" field, e.g. {\"type\":\"hero\",...}. No code fences, no prose, no blank lines, no line breaks inside a JSON object.`;

function taskBlock(req: DesignRequest): string {
  const pattern = patternById(req.pattern);
  return [
    `- Pre-selected layout: "${pattern.label}" (${pattern.description}).`,
    `- ${DEPTH_HINT[req.depth]}`,
    req.intent ? `- What the person wants: ${req.intent} Answer that; sources that only match their words but not this are background at most.` : '',
    req.simple ? '- Write for a 10-year-old: plain words and a friendly analogy.' : '',
    followupRules(req.followup, req.search.query).trim().replace(/^/, '- '),
    req.search.results.length ? '' : '- No web sources were found for this; answer from general knowledge, say it may be out of date, and do not cite sources.',
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
function priceSources(req: DesignRequest): PriceSource[] {
  return req.search.results.slice(0, 30).map((r) => ({ url: r.url, date: r.date }));
}

/** Drops citation markers and citation nodes when there is nothing to cite. */
function uncite(node: CardNode): CardNode | undefined {
  if (node.type === 'citations' || node.type === 'code') return node.type === 'code' ? node : undefined;
  const strip = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(/\s*\[\d+\]/g, '').replace(/ {2,}/g, ' ').trim();
    if (Array.isArray(value)) return value.map(strip).filter((item) => item !== undefined);
    if (value && typeof value === 'object') {
      const src = value as Record<string, unknown>;
      if (src.type === 'code') return src;
      if (src.type === 'citations') return undefined;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(src)) {
        const next = strip(item);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }
    return value;
  };
  const next = strip(node);
  if (!next || typeof next !== 'object') return undefined;
  const card = next as CardNode;
  if (card.type === 'text' && !card.text) return undefined;
  if ('children' in card && card.children.length === 0) return undefined;
  return card;
}

function emitReady(node: CardNode | undefined, bare: boolean): CardNode | undefined {
  if (!node) return undefined;
  return bare ? uncite(node) : node;
}

function parseLine(line: string, g: Grounding, imageCount: number, query: string, sources?: PriceSource[], seatQuery?: string): Parsed | undefined {
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
  // The header line: no node type, or an unknown type that still carries a title ({"type":"header","title":...}).
  if (!('type' in obj) || (!NODE_TYPES.has(String(obj.type)) && typeof obj.title === 'string')) {
    const head = sanitizeCard({ ...obj, type: undefined, body: [] }, imageCount, query);
    return { kind: 'head', head: { title: head.title, subtitle: head.subtitle && g.ok(head.subtitle) ? head.subtitle : undefined, icon: head.icon, accent: head.accent } };
  }
  const [clean] = sanitizeNodes([obj], imageCount, 0, { sources, query: seatQuery ?? query });
  const [grounded] = clean ? groundNodes([clean], g) : [];
  return grounded ? { kind: 'node', node: grounded } : { kind: 'dropped' };
}

const NODE_TYPES = new Set<string>(['stack', 'grid', 'section', 'tabs', 'scroller', 'divider', 'hero', 'heading', 'text', 'stat', 'tile', 'keyvalue', 'list', 'chart', 'progress', 'rating', 'table', 'timeline', 'steps', 'proscons', 'badges', 'quote', 'callout', 'draft', 'code', 'links', 'video', 'image', 'gallery', 'profile', 'actions', 'choices', 'slider', 'scaler', 'pricing', 'accordion', 'reveal', 'citations'] satisfies CardNode['type'][]);

/** Explanations and conversation turns may run longer; everything else stays glanceable. */
function textCap(req: DesignRequest): number {
  return req.followup?.mode === 'chat' || req.pattern === 'explainer' || req.simple ? 700 : 320;
}

const MAX_CONTENT_NODES = 8;

const isContent = (n: CardNode) => n.type !== 'actions' && n.type !== 'citations';

/** Streams a designed card from a single call: header first, then each grounded top-level node as soon as it is written. */
export async function designStream(req: DesignRequest, env: Env, on: DesignEvents): Promise<DesignSummary> {
  const imageCount = Math.min(req.search.images.length, 12);
  if (!hasLlm(env)) return extractive(req, on);

  const chat = req.followup?.mode === 'chat';
  const g = new Grounding(corpusOf(req), chat);
  const polish = new Polisher(textCap(req));
  const pictures = new PictureResolver(env, req.search.images, on.credit, req.query, undefined, req.rowImages && { ...req.rowImages, results: req.search.results });
  const base = req.followup?.mode === 'refine' && req.followup.baseCard ? `CURRENT CARD\n${JSON.stringify(req.followup.baseCard).slice(0, 12000)}\n\n` : '';
  const user = `${sourcesBlock(req.search, req.pages)}\n\n${base}SKELETON\n${JSON.stringify(patternById(req.pattern).skeleton)}\n\nTASK\n${taskBlock(req)}\n\nQUERY: ${req.followup?.question ?? req.query}`;

  let headSent = false;
  let index = 0;
  let contentNodes = 0;
  let removed = 0;
  let via: string | undefined;
  let lines = 0;
  let unparsed = 0;
  let failure: string | undefined;
  try {
    const sources = priceSources(req);
    via = await llmLines(env, SYSTEM_WHOLE, user, 2800, (line) => {
      lines++;
      const parsed = parseLine(line, g, imageCount, req.query, sources, req.followup?.question ?? req.query);
      if (!parsed) {
        unparsed++;
        return;
      }
      switch (parsed.kind) {
        case 'followups':
          return on.followups(parsed.items);
        case 'head':
          if (headSent) return;
          headSent = true;
          return on.head(parsed.head);
        case 'node': {
          const polished = polish.apply(parsed.node);
          // A price on the store's own page cites that page, not a roundup.
          const node = polished && emitReady(stampOfficialPriceCite(polished, req.query, req.search.results), req.search.results.length === 0);
          if (!node) return;
          if (isContent(node)) {
            if (contentNodes >= MAX_CONTENT_NODES) return;
            contentNodes++;
          }
          return pictures.emit(node, index++, on.node);
        }
        case 'dropped':
          removed++;
          return;
        default: {
          const unreachable: never = parsed;
          return unreachable;
        }
      }
    }, { think: req.think, onThinking: on.thinking });
  } catch (err) {
    console.error('Design stream failed', err);
    failure = err instanceof Error ? err.message : String(err);
  }
  await pictures.flush();
  if (!contentNodes) {
    // One line per fallback so `wrangler pages deployment tail` shows why the model gave no card.
    console.warn('design fallback', JSON.stringify({ via: via ?? null, lines, unparsed, removed, head: headSent, failure: failure?.slice(0, 200) ?? null }));
    return extractive(req, on);
  }
  return { engine: chat ? 'reasoning' : 'composed', removed, via };
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

/** "symptoms of vitamin d deficiency" → "Symptoms of Vitamin D Deficiency", for when the model sends no title. */
function titleCase(q: string): string {
  return q
    .trim()
    .replace(/[?.!]+$/, '')
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
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
const FINISH_ORDER: Partial<Record<CardNode['type'], number>> = { choices: 0, slider: 0, scaler: 0, pricing: 0, accordion: 0, reveal: 0, actions: 1, citations: 2 };
const FINISH_SLOTS = 3;

/**
 * Designs each top-level region of the skeleton in its own concurrent call, plus
 * one call for the header, an interactive control, actions, citations and
 * follow-ups. Regions fill their placeholders as soon as they are ready, so the
 * card completes in roughly the time of its slowest region.
 */
export async function designParallel(req: DesignRequest, env: Env, on: DesignEvents): Promise<DesignSummary> {
  const imageCount = Math.min(req.search.images.length, 12);
  if (!hasLlm(env)) return extractive(req, on);

  const regions = patternById(req.pattern).skeleton;
  on.layout(regions);
  const sources = priceSources(req);
  const g = new Grounding(corpusOf(req));
  const pictures = new PictureResolver(env, req.search.images, on.credit, req.query, undefined, req.rowImages && { ...req.rowImages, results: req.search.results });
  const polish = new Polisher(textCap(req));
  const shared = `${sourcesBlock(req.search, req.pages, 2800)}\n\nTASK\n${taskBlock(req)}\n- Card regions, top to bottom:\n${regions.map((r, i) => `  R${i + 1}: ${regionPurpose(r)}`).join('\n')}\n  FINISH: header, interactive control, actions, citations, follow-ups`;
  const query = req.followup?.question ?? req.query;

  let contentNodes = 0;
  let removed = 0;

  let headSentAny = false;
  const regionCall = (region: CardNode, i: number) => {
    const user = `${shared}\n- YOU DESIGN R${i + 1}: ${JSON.stringify(region)}. Replace its slots with real components; you may reshape it (a stack or grid can hold several components) but keep to this region's purpose.${i === 0 ? ' R1 is the lead: it must answer the question at a glance.' : ''}\n- Output exactly one line: one JSON node.\n\nQUERY: ${query}`;
    let done = false;
    return llmLines(env, SYSTEM_REGION, user, 1200, (line) => {
      if (done) return;
      const parsed = parseLine(line, g, imageCount, req.query, sources, req.followup?.question ?? req.query);
      if (parsed?.kind === 'node') {
        done = true;
        const polished = polish.apply(parsed.node);
        const node = polished && emitReady(stampOfficialPriceCite(polished, req.query, req.search.results), req.search.results.length === 0);
        if (!node) return;
        contentNodes++;
        pictures.emit(node, i, on.node);
      } else if (parsed?.kind === 'dropped') removed++;
    });
  };

  const finishCall = () => {
    const user = `${shared}\n- YOU DESIGN FINISH. Output these lines:\n  1. {"title":string,"subtitle":string,"icon":string,"accent":tone} for the whole card\n  2. only if the answer has something worth adjusting, exploring or testing: one interactive node such as {"type":"pricing",...}, {"type":"choices",...} or {"type":"slider",...} that the regions above don't already cover. For plan or subscription prices this must be a pricing node.\n  3. {"type":"actions","items":[...]} with 2-4 useful next steps (prefer kind "refine" for changes to this card)\n  4. {"type":"citations","refs":[...]} with the source numbers that matter most\n  5. {"followups":[4 short follow-up questions, each naming the subject so it stands alone]}\n\nQUERY: ${query}`;
    let extra = 0;
    return llmLines(env, SYSTEM_REGION, user, 1000, (line) => {
      const parsed = parseLine(line, g, imageCount, req.query, sources, req.followup?.question ?? req.query);
      if (!parsed) return;
      switch (parsed.kind) {
        case 'head':
          if (!headSentAny) on.head(parsed.head);
          headSentAny = true;
          return;
        case 'followups':
          return on.followups(parsed.items);
        case 'node': {
          if (parsed.node.type === 'heading' && !headSentAny) {
            const heading = emitReady(parsed.node, req.search.results.length === 0);
            if (heading?.type !== 'heading' || !heading.text) return;
            headSentAny = true;
            return on.head({ title: heading.text, subtitle: heading.eyebrow });
          }
          const node = emitReady(stampOfficialPriceCite(parsed.node, req.query, req.search.results), req.search.results.length === 0);
          if (!node) return;
          const order = FINISH_ORDER[node.type];
          return pictures.emit(node, order === undefined ? regions.length + FINISH_SLOTS + extra++ : regions.length + order, on.node);
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
  if (!headSentAny) on.head({ title: titleCase(req.query) });
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error('region failed', (r as PromiseRejectedResult).reason));
  await pictures.flush();
  if (!contentNodes) return extractive(req, on);
  const via = [...new Set(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))].join(' + ') || undefined;
  return { engine: 'composed', removed, via };
}

/** Builds a card straight from snippet sentences when no generator is available. */
function extractive(req: DesignRequest, on: DesignEvents): DesignSummary {
  const { search, pattern: patternId, query } = req;
  const cands = candidates(search);
  const stats = extractStats(cands, 4);
  const timeline = extractTimeline(cands);
  const k = search.knowledge;
  const onTopic = !!k && knowledgeMatches(query, k.title, k.description);
  const imageRef = k?.image ? search.images.findIndex((img) => img.thumb === k.image) : -1;
  const body: CardNode[] = [];

  if (onTopic && k && ['profile', 'visual', 'explainer', 'answer'].includes(patternId)) {
    body.push({ type: 'profile', name: k.title, subtitle: k.description, imageRef: imageRef >= 0 ? imageRef : undefined });
  }
  if (cands[0]) body.push({ type: 'text', text: cands[0].text, size: 'lg' });
  if (stats.length >= 2) body.push({ type: 'grid', cols: 2, children: stats.map((s) => ({ type: 'stat', label: clip(s.label, 60), value: s.value })) });
  if (timeline.length >= 3) body.push({ type: 'timeline', items: timeline.map((t) => ({ when: t.when, title: t.text })) });
  if (search.images.length >= 3 && ['visual', 'profile', 'spotlight'].includes(patternId)) body.push({ type: 'gallery', refs: [0, 1, 2, 3, 4, 5].filter((i) => i < search.images.length) });
  if (cands.length > 1) body.push({ type: 'section', title: 'Key points', icon: 'pin', children: [{ type: 'list', style: 'check', items: cands.slice(1, 6).map((c) => ({ text: c.text, meta: c.domain })) }] });
  const refs = [1, 2, 3, 4].filter((i) => i <= search.results.length);
  if (refs.length) body.push({ type: 'citations', refs });

  on.head({ title: onTopic && k ? k.title : query, subtitle: patternById(patternId).label });
  body.forEach((node, i) => on.node(node, i));
  return { engine: 'extractive', removed: 0 };
}
