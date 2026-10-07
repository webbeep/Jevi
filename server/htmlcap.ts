/** Characters of HTML passed to the page-read regexes. */
export const PAGE_HTML_CAP = 150_000;

/** Max characters ever read from the stream while looking for the content anchor. */
export const PAGE_READ_LIMIT = 600_000;

const CUT_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe'];
const OVERLAP = 10;
const CONTENT_NEEDLES = ['<main', '<MAIN', '<article', '<ARTICLE'];
const BODY_NEEDLES = ['<body', '<BODY'];

/**
 * Reads until the article window is full, the read limit is hit, or the stream ends.
 * `head` is only for og:image. `body` is the capped window at the first `<main`/`<article`,
 * or else the first `<body`.
 */
export async function readPage(
  res: Response,
  cap = PAGE_HTML_CAP,
  readLimit = PAGE_READ_LIMIT,
): Promise<{ head: string; body: string; cut: boolean }> {
  if (!res.body) return { head: '', body: '', cut: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let anchor = -1;
  let kind: 'content' | 'body' | null = null;
  let exhausted = false;
  /** Tail of the previous chunk so a tag split across reads is still visible. */
  let carry = '';

  /** indexOf over the new chunk plus that tail. Does not slice the accumulated HTML. */
  const note = (region: string, regionStart: number) => {
    if (kind === 'content') return;
    const contentAt = earliestTag(region, CONTENT_NEEDLES);
    if (contentAt >= 0 && regionStart + contentAt < readLimit) {
      anchor = regionStart + contentAt;
      kind = 'content';
      return;
    }
    if (kind === 'body') return;
    const bodyAt = earliestTag(region, BODY_NEEDLES);
    if (bodyAt >= 0 && regionStart + bodyAt < readLimit) {
      anchor = regionStart + bodyAt;
      kind = 'body';
    }
  };

  try {
    while (kind !== 'content' || html.length < anchor + cap) {
      if (html.length >= readLimit) break;
      const { done, value } = await reader.read();
      const prevLen = html.length;
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (chunk) {
        const room = readLimit - prevLen;
        const visible = chunk.length > room ? chunk.slice(0, room) : chunk;
        note(carry + visible, prevLen - carry.length);
        html += chunk;
        carry = chunk.length > OVERLAP ? chunk.slice(-OVERLAP) : chunk;
      }
      if (done) {
        exhausted = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (html.length > readLimit) html = html.slice(0, readLimit);

  const anchorOrEnd = anchor >= 0 ? anchor : html.length;
  const head = html.slice(0, Math.min(anchorOrEnd, cap));
  const start = anchor >= 0 ? anchor : 0;
  let body = html.slice(start, start + cap);
  const cut = !exhausted || html.length > start + cap;
  if (cut) body = trimCut(body);
  return { head, body, cut };
}

/** Drops a cut-off unclosed element or a trailing partial tag so later regexes see a finished tail. */
export function trimCut(html: string): string {
  const lower = html.toLowerCase();
  let end = html.length;
  for (const tag of CUT_TAGS) {
    const open = lastTag(lower, `<${tag}`);
    if (open < 0) continue;
    const close = lastTag(lower, `</${tag}`);
    if (open > close) end = Math.min(end, open);
  }
  const head = end < html.length ? html.slice(0, end) : html;
  const lastLt = head.lastIndexOf('<');
  if (lastLt > head.lastIndexOf('>')) return head.slice(0, lastLt);
  return head;
}

/** Last `<tag` / `</tag` whose next character ends the tag name, not a longer token. */
function lastTag(lower: string, needle: string): number {
  let from = lower.length;
  while (from > 0) {
    const at = lower.lastIndexOf(needle, from - 1);
    if (at < 0) return -1;
    const c = lower.charAt(at + needle.length);
    if (c === '' || c === '>' || c === '/' || c <= ' ') return at;
    from = at;
  }
  return -1;
}

function earliestTag(lower: string, needles: string[]): number {
  let best = -1;
  for (const needle of needles) {
    const at = findTag(lower, needle);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

/** First `<tag` whose next character is whitespace, `>`, or `/`. An unfinished tail does not count. */
function findTag(lower: string, needle: string): number {
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return -1;
    const c = lower.charAt(at + needle.length);
    if (c === '>' || c === '/' || (c !== '' && c <= ' ')) return at;
    from = at + 1;
  }
  return -1;
}
