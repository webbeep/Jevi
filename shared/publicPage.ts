import { fnv1a, normalizeAnswerQuery } from './answerKey';
import type { AnswerCard, CardNode, ImageCredit, Tone } from './card';
import { packHistorySources, type HistorySource } from './historyCard';
import { liveBody } from './liveBody';
import { settleCardPrices } from './pricing';

/** A public path for one finished answer. The same question always maps to the same path. */
export function answerSlug(query: string): string {
  const norm = normalizeAnswerQuery(query);
  const words = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${words || 'answer'}-${fnv1a(norm)}`;
}

export function answerPath(query: string): string {
  return `/a/${answerSlug(query)}`;
}

export interface PublicAnswer {
  slug: string;
  query: string;
  title: string;
  description: string;
  body: string;
}

/** The card a recipient opens, plus the sources its pictures and citations point at. */
export interface ShareCard {
  card: AnswerCard;
  results: HistorySource[];
  followups: string[];
}

const TONES = new Set<Tone>(['default', 'muted', 'primary', 'positive', 'negative', 'warning']);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function pushText(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const row = node as Record<string, unknown>;
  if (row.type === 'actions' || row.type === 'citations' || row.type === 'image' || row.type === 'gallery' || row.type === 'video') return;
  for (const key of ['text', 'title', 'value', 'label', 'caption', 'sub', 'name', 'when', 'detail']) {
    if (typeof row[key] === 'string' && row[key]) out.push(row[key] as string);
  }
  if (Array.isArray(row.children)) for (const child of row.children) pushText(child, out);
  if (Array.isArray(row.tabs)) for (const tab of row.tabs) pushText(tab, out);
  if (Array.isArray(row.items)) {
    for (const item of row.items) {
      if (typeof item === 'string') out.push(item);
      else pushText(item, out);
    }
  }
  if (Array.isArray(row.rows)) {
    for (const line of row.rows) {
      if (Array.isArray(line)) out.push(line.filter((cell) => typeof cell === 'string').join(' · '));
    }
  }
  if (Array.isArray(row.facts)) for (const fact of row.facts) pushText(fact, out);
}

interface ReadAnswer {
  title: string;
  subtitle: string;
  icon?: string;
  accent?: Tone;
  nodes: (CardNode | undefined)[];
  credits: ImageCredit[];
  followups: string[];
  results: HistorySource[];
  parts: string[];
  skip: boolean;
}

function isCardNode(value: unknown): value is CardNode {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

/** One pass over a finished stream: crawler text, and the card the app restores. */
function readAnswer(query: string, frames: readonly string[]): ReadAnswer {
  let title = '';
  let subtitle = '';
  let icon: string | undefined;
  let accent: Tone | undefined;
  const nodes: (CardNode | undefined)[] = [];
  const credits: ImageCredit[] = [];
  let followups: string[] = [];
  let results: HistorySource[] = [];
  const parts: string[] = [];
  let degraded = false;
  let choices = false;
  let extractive = false;
  for (const frame of frames) {
    const event = frame.match(/^event: (\w+)/)?.[1];
    const data = frame.match(/^data: (.*)$/m)?.[1];
    if (!event || !data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const row = parsed as {
      title?: string;
      subtitle?: string;
      icon?: string;
      accent?: string;
      index?: number;
      node?: unknown;
      engine?: string;
      degraded?: boolean;
      choices?: unknown;
      results?: unknown;
      src?: string;
      link?: string;
      credit?: string;
      license?: ImageCredit['license'];
    };
    if (event === 'head') {
      title = row.title?.trim() || title;
      subtitle = row.subtitle?.trim() || subtitle;
      if (typeof row.icon === 'string' && row.icon) icon = row.icon;
      if (row.accent && TONES.has(row.accent as Tone)) accent = row.accent as Tone;
    } else if (event === 'node' && isCardNode(row.node)) {
      const index = typeof row.index === 'number' && row.index >= 0 ? Math.floor(row.index) : nodes.length;
      nodes[index] = row.node;
      pushText(row.node, parts);
    } else if (event === 'search' && Array.isArray(row.results)) {
      results = packHistorySources(row.results as { title?: string; url?: string; snippet?: string; domain?: string; image?: string; date?: string }[]);
    } else if (event === 'credit' && typeof row.src === 'string' && typeof row.link === 'string' && typeof row.credit === 'string' && row.license) {
      credits.push({ src: row.src, link: row.link, credit: row.credit, license: row.license });
    } else if (event === 'followups' && Array.isArray(parsed)) {
      followups = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8);
    } else if (event === 'done') {
      if (row.engine === 'extractive' || row.degraded) extractive = true;
      if (Array.isArray(row.choices)) choices = true;
    } else if (event === 'notice') {
      degraded = true;
    }
  }
  return {
    title,
    subtitle,
    icon,
    accent,
    nodes,
    credits,
    followups,
    results,
    parts,
    skip: !nodes.some(Boolean) || degraded || choices || extractive,
  };
}

/** Read a finished SSE stream into the fields a crawler should see. Undefined when there is no card. */
export function publicAnswerFromFrames(query: string, frames: readonly string[]): PublicAnswer | undefined {
  const read = readAnswer(query, frames);
  if (read.skip) return undefined;
  const heading = read.title || query.trim();
  const body = [read.subtitle, ...read.parts].map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if (!heading || !body) return undefined;
  return {
    slug: answerSlug(query),
    query: query.trim(),
    title: clip(heading, 70),
    description: clip(read.subtitle || body, 160),
    body: body.slice(0, 8000),
  };
}

/** The same finished stream, as the card the app shows. Undefined when the answer is not published. */
export function shareCardFromFrames(query: string, frames: readonly string[]): ShareCard | undefined {
  const read = readAnswer(query, frames);
  if (read.skip) return undefined;
  const body = liveBody({ nodes: settleCardPrices(read.nodes, query), regions: [] }, false);
  if (!body.length) return undefined;
  return {
    card: {
      title: read.title || query.trim(),
      ...(read.subtitle ? { subtitle: read.subtitle } : {}),
      ...(read.icon ? { icon: read.icon } : {}),
      ...(read.accent ? { accent: read.accent } : {}),
      body,
      ...(read.credits.length ? { credits: read.credits } : {}),
    },
    results: read.results,
    followups: read.followups,
  };
}

export interface ShareView {
  query: string;
  card: AnswerCard;
  results: HistorySource[];
  followups: string[];
}

/** A stored card when the answer has one, otherwise the published text inside a card. */
export function shareView(page: PublicAnswer, share: ShareCard | undefined): ShareView {
  if (share && share.card.body.length > 0) {
    return { query: page.query, card: share.card, results: share.results, followups: share.followups };
  }
  const lines = page.body.split('\n').map((line) => line.trim()).filter(Boolean);
  return {
    query: page.query,
    card: {
      title: page.title,
      ...(page.description ? { subtitle: page.description } : {}),
      body: lines.map((text) => ({ type: 'text', text })),
    },
    results: [],
    followups: [],
  };
}

/** Full HTML for one answer. The text is in the document, not only in a script. */
export function renderAnswerHtml(page: PublicAnswer, origin: string): string {
  const url = `${origin}/a/${page.slug}`;
  const image = `${origin}/og/${page.slug}.png`;
  const paragraphs = page.body.split('\n').map((line) => `    <p>${esc(line)}</p>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>zo</title>
  <meta name="description" content="${esc(page.description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(page.title)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <style>
    body { margin: 0; font: 18px/1.5 Georgia, serif; background: #f7f7f5; color: #141414; }
    main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    a { color: inherit; }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .5rem; }
    .ask { font: 15px/1.4 system-ui, sans-serif; }
    p { margin: .6rem 0; }
  </style>
</head>
<body>
  <main>
    <h1>${esc(page.title)}</h1>
    <p class="ask">${esc(page.query)}</p>
${paragraphs}
  </main>
</body>
</html>`;
}
