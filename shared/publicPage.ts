import { fnv1a, normalizeAnswerQuery } from './answerKey';

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

/** Read a finished SSE stream into the fields a crawler should see. Undefined when there is no card. */
export function publicAnswerFromFrames(query: string, frames: readonly string[]): PublicAnswer | undefined {
  let title = '';
  let subtitle = '';
  const parts: string[] = [];
  let degraded = false;
  let choices = false;
  let extractive = false;
  let nodes = 0;
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
    const row = parsed as { title?: string; subtitle?: string; node?: unknown; engine?: string; degraded?: boolean; choices?: unknown };
    if (event === 'head') {
      title = row.title?.trim() || title;
      subtitle = row.subtitle?.trim() || subtitle;
    } else if (event === 'node' && row.node) {
      nodes += 1;
      pushText(row.node, parts);
    } else if (event === 'done') {
      if (row.engine === 'extractive' || row.degraded) extractive = true;
      if (Array.isArray(row.choices)) choices = true;
    } else if (event === 'notice') {
      degraded = true;
    }
  }
  if (!nodes || degraded || choices || extractive) return undefined;
  const heading = title || query.trim();
  const body = [subtitle, ...parts].map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if (!heading || !body) return undefined;
  return {
    slug: answerSlug(query),
    query: query.trim(),
    title: clip(heading, 70),
    description: clip(subtitle || body, 160),
    body: body.slice(0, 8000),
  };
}

/** Full HTML for one answer. The text is in the document, not only in a script. */
export function renderAnswerHtml(page: PublicAnswer, origin: string): string {
  const url = `${origin}/a/${page.slug}`;
  const image = `${origin}/og/${page.slug}.png`;
  const ask = `${origin}/?${new URLSearchParams({ q: page.query })}`;
  const paragraphs = page.body.split('\n').map((line) => `    <p>${esc(line)}</p>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(page.title)} — ZO</title>
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
    <p class="ask"><a href="${esc(origin)}/">ZO</a> — Good search should be free.</p>
    <h1>${esc(page.title)}</h1>
    <p class="ask">Asked: ${esc(page.query)}</p>
${paragraphs}
    <p class="ask"><a href="${esc(ask)}">Open this in ZO</a></p>
  </main>
</body>
</html>`;
}
