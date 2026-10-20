import { boundAsk } from '../shared/queryBound';
import type { AnswerCard, CardNode } from '../shared/card';
import { keepShownComponent } from '../shared/keepShown';
import type { SearchResult } from '../shared/types';
import { BRIEF_ROWS, rowLine, type SourceBrief } from './brief';
import { hasLlm, llmJson } from './llm';
import type { Env } from './util';
import { fitContext } from '../shared/contextFit';

/**
 * After the card is written and before it is saved: one model read of the finished card against the goal,
 * today's date, the conversation and the sources. Wrong nodes are rewritten in place; a problem the
 * sources can't fix becomes a warning above the answer instead of a confident wrong card.
 */
const SYSTEM = `You review an answer card before it is saved, like a careful editor checking facts. Judge it against what the person wants, today's date, the conversation and the search results.
Flag only real errors that would mislead the reader:
- it does not answer the goal, or answers a different question. A follow-up about a different case that still leads with the previous case's figure does not answer it;
- a how-to is a paragraph or skips steps the official page states, instead of those steps in order;
- a requested quote is a paraphrase, a fragment, or a sentence that drops the numbers the page states;
- a price, tax, or fee is not the figure the official source states, or another number on the card fights that figure;
- a health line states a different figure or the opposite of the official verdict it leads with;
- a comparison is not a visual table of each product the question named, or it leads with a different variant;
- it is about the wrong subject (a namesake, another company, product, place or period);
- it presents an old value or old news as current (check dates against today), or contradicts a LIVE result or newer results;
- a stated fact, number or date is not supported by the results, or is attributed to the wrong thing;
- it carries over facts from the conversation that belong to a different subject;
- two nodes show the same fact, number or chart (fix the later one with something else the results support, or a short text node);
- a suggested follow-up or action assumes something false or unsupported: an event that didn't happen, an older event presented as today's, a number the card doesn't show;
- it leaves out a fact the goal needs that the results state (often in the "More results"): the threshold that keeps it safe (a cooking temperature), the fee or limit a step or rule sets, or an exception the official page names. Add it to the node where it belongs, citing the result that states it; never invent it.
You see the result snippets and the page text the writer read (clipped). A fact found in neither may come from a part of a page you can't see: flag it only when the results contradict it, or when it is a current value (price, score, date of an event) that nothing supports.
Style, wording, layout and nice-to-haves the goal does not need are not errors. For a "today" or "latest" ask, anything from the past 36 hours is current: don't flag it, and don't warn that nothing is dated exactly today.
Reply as JSON: {"verdict":"ok"|"fix","problems":[string],"fixes":[{"node":number,"replace":object}],"note":string,"followups":[string]}
- problems: one short line per error, naming the node number.
- Every problem the results let you fix comes with its fix, and then the verdict is "fix". A problem listed without a fix changes nothing.
- fixes: for each wrong node you can correct from the results, a full replacement node in the same JSON shape as the original (same "type" when possible), with facts only from the results and citations like [2]. Keep every supported fact of the original; never blank a value out with "—" or drop a comparison side. At most 3.
- note: only when the results themselves leave the answer uncertain (no current figure, sources disagree, the person can't be identified): one plain sentence for the reader about that uncertainty. Never describe the card's own mistakes in the note (no "the card says…", "the card mixes…"): fix those nodes instead. Otherwise "".
- followups: only when a suggested follow-up is wrong: the full list of 4 again, with each wrong one replaced by a question the card supports. Otherwise [].
- verdict "ok" with empty problems, fixes, note and followups when the card is right.`;

interface Raw {
  verdict?: unknown;
  problems?: unknown;
  fixes?: unknown;
  note?: unknown;
  followups?: unknown;
}

export interface Review {
  ok: boolean;
  problems: string[];
  fixes: { index: number; node: unknown }[];
  note?: string;
  /** Replacement follow-up questions, when a suggested one was wrong. */
  followups?: string[];
}

const SELF_REMARK = /\b(the|this) (card|answer)('s)?\b|\bnode \d/i;

const NODE_CHARS = 900;
const PAGE_CHARS = 1500;
const CARD_CHARS = 7000;

export function readReview(raw: Raw | undefined, indices: Set<number>): Review | undefined {
  if (!raw || (raw.verdict !== 'ok' && raw.verdict !== 'fix')) return undefined;
  const problems = Array.isArray(raw.problems) ? raw.problems.filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim().slice(0, 200)).slice(0, 5) : [];
  const fixes = Array.isArray(raw.fixes)
    ? raw.fixes
        .filter((f): f is { node: number; replace: Record<string, unknown> } =>
          !!f && typeof f === 'object' && Number.isInteger((f as { node?: unknown }).node) && indices.has((f as { node: number }).node)
          && !!(f as { replace?: unknown }).replace && typeof (f as { replace?: unknown }).replace === 'object')
        .slice(0, 3)
        .map((f) => ({ index: f.node, node: f.replace }))
    : [];
  const said = typeof raw.note === 'string' ? raw.note.trim().replace(/\s+/g, ' ').slice(0, 240) : '';
  // A note about the card's own wording is an editor's remark, not something the reader should see.
  const note = said && !SELF_REMARK.test(said) ? said : undefined;
  const followups = Array.isArray(raw.followups)
    ? raw.followups.filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => boundAsk(f)).filter(Boolean).slice(0, 4)
    : [];
  // A fix names a node and applies whatever the verdict says: a reviewer that lists one under "ok" still fixed
  // something. A note or replacement follow-ups count only when the reviewer also raised a problem.
  const claimed = raw.verdict === 'fix' || problems.length > 0;
  const ok = !fixes.length && !(claimed && (note || followups.length));
  return { ok, problems, fixes: ok ? [] : fixes, note: ok ? undefined : note, ...(!ok && followups.length ? { followups } : {}) };
}

const PICTURE_KEYS = ['imageSrc', 'imageRef', 'imageQuery'] as const;
const hasPicture = (o: Record<string, unknown>) => o.imageSrc !== undefined || o.imageRef !== undefined;

/**
 * Pictures are placed after the card is written and nothing places them after the review: a corrected
 * node keeps the picture of the node it replaces, part by part, wherever it has none of its own,
 * and a profile keeps its website link the same way.
 */
export function keepPictures(before: unknown, after: unknown): unknown {
  if (Array.isArray(before) && Array.isArray(after)) return after.map((item, i) => keepPictures(before[i], item));
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return after;
  const was = before as Record<string, unknown>;
  const now = { ...(after as Record<string, unknown>) };
  if (was.type !== now.type) return after;
  if (!hasPicture(now) && hasPicture(was)) for (const k of PICTURE_KEYS) now[k] = was[k];
  if (now.website === undefined && was.website !== undefined) now.website = was.website;
  for (const k of ['children', 'items']) if (Array.isArray(now[k])) now[k] = keepPictures(was[k], now[k]);
  return now;
}

/** Top-level nodes as the reviewer reads them; actions, citations and pictures carry no claims. */
function cardText(head: Omit<AnswerCard, 'body'> | undefined, nodes: Map<number, CardNode>): string {
  const lines = [`Title: ${head?.title ?? ''}${head?.subtitle ? ` — ${head.subtitle}` : ''}`];
  let used = 0;
  for (const [index, node] of [...nodes].sort((a, b) => a[0] - b[0])) {
    if (node.type === 'citations' || node.type === 'gallery' || node.type === 'image' || node.type === 'video') continue;
    const json = node.type === 'ticker'
      ? JSON.stringify({ type: 'ticker', note: 'live price chart from the quote feed (correct by construction)', name: node.name, price: node.series.price, at: node.series.at })
      : node.type === 'actions'
        ? JSON.stringify({ type: 'actions', items: node.items.map(({ label, query, kind }) => ({ label, query, kind })) })
        : JSON.stringify(node).slice(0, NODE_CHARS);
    if (used + json.length > CARD_CHARS) break;
    used += json.length;
    lines.push(`Node ${index}: ${json}`);
  }
  return lines.join('\n');
}

export async function reviewCard(
  args: {
    query: string;
    context?: string;
    brief?: SourceBrief;
    results: SearchResult[];
    /** Page text the writer read, numbered like the results. */
    pages?: { n: number; text: string }[];
    isLive: (r: SearchResult) => boolean;
    head?: Omit<AnswerCard, 'body'>;
    nodes: Map<number, CardNode>;
    followups?: string[];
    /** Rows a search for a missing key fact found, numbered after `results`. */
    extra?: SearchResult[];
  },
  env: Env,
  timeoutMs = 2200,
): Promise<Review | undefined> {
  if (!hasLlm(env) || !args.nodes.size) return undefined;
  const user = [
    `Today is ${new Date().toISOString().slice(0, 10)} (UTC).`,
    args.context ? `Conversation so far:\n${fitContext(args.context, 1200)}` : '',
    `Asked: ${args.query}`,
    args.brief ? `Goal: ${args.brief.goal}` : '',
    args.brief?.stale.length ? `Outdated results: ${args.brief.stale.map((n) => `[${n}]`).join(' ')}` : '',
    args.brief?.offTopic.length ? `Off-topic results: ${args.brief.offTopic.map((n) => `[${n}]`).join(' ')}` : '',
    `Results:\n${args.results.slice(0, BRIEF_ROWS).map((r, i) => rowLine(r, i, args.isLive(r))).join('\n')}`,
    args.extra?.length ? `More results, from a search for a key fact the first results lacked:\n${args.extra.map((r, i) => rowLine(r, args.results.length + i, false)).join('\n')}` : '',
    args.pages?.length ? `Page text the writer read:\n${args.pages.slice(0, 5).map((p) => `[${p.n}] ${p.text.replace(/\s+/g, ' ').slice(0, PAGE_CHARS)}`).join('\n')}` : '',
    `CARD\n${cardText(args.head, args.nodes)}`,
    args.followups?.length ? `Suggested follow-ups:\n${args.followups.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  const call = llmJson<Raw>(env, SYSTEM, user, 1200).catch((err) => {
    console.log(JSON.stringify({ zo: 'review', failed: String(err).slice(0, 120) }));
    return undefined;
  });
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  return readReview(await Promise.race([call, timeout]), new Set(args.nodes.keys()));
}

const PRECISION = `You check one finished answer card against the sources. Flag only a real inconsistency:
- a denial ("not stated", "no source", "unavailable") next to a number the card already shows for that fact
- a fact copied onto the wrong person or product
- a component that does not answer the question
Reply as JSON: {"verdict":"ok"} or {"verdict":"fix","index":number,"find":string,"replace":string,"search":string}
- index: the node number that is wrong
- find: a short exact substring of that one component (one cell or one sentence), never the whole card
- replace: the corrected substring only. Keep every other word. Use a number only when a source states it.
- search: one web query when the sources do not contain the fact the fix needs. Otherwise "".
Style and missing nice-to-haves are not errors. verdict "ok" when the card is consistent.`;

const SKIP_FIELDS = new Set(['imageSrc', 'imageQuery', 'imageRef', 'src', 'url', 'href', 'link', 'thumb', 'icon', 'id', 'type', 'lang', 'mermaid', 'website']);

export interface PrecisionFix {
  index: number;
  find: string;
  replace: string;
  search?: string;
}

interface RawPrecision {
  verdict?: unknown;
  index?: unknown;
  find?: unknown;
  replace?: unknown;
  search?: unknown;
}

export function readPrecision(raw: RawPrecision | undefined, indices: Set<number>): PrecisionFix | undefined {
  if (!raw || raw.verdict === 'ok') return undefined;
  if (raw.verdict !== 'fix' || !Number.isInteger(raw.index) || !indices.has(raw.index as number)) return undefined;
  const find = typeof raw.find === 'string' ? raw.find.trim() : '';
  const replace = typeof raw.replace === 'string' ? raw.replace.replace(/\s+/g, ' ').trim() : '';
  if (find.length < 2 || find.length > 240 || replace.length > 400 || find === replace) return undefined;
  const search = typeof raw.search === 'string' ? raw.search.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
  return { index: raw.index as number, find, replace, ...(search.length > 2 ? { search } : {}) };
}

/** The first exact substring in one component. Picture URLs and other machine fields stay. */
export function applyTextEdit(node: CardNode, find: string, replace: string): CardNode | undefined {
  const needle = find.trim();
  if (needle.length < 2 || needle === replace) return undefined;
  let used = false;
  const edit = (value: unknown, key?: string): unknown => {
    if (key && SKIP_FIELDS.has(key)) return value;
    if (typeof value === 'string') {
      if (used || !value.includes(needle)) return value;
      used = true;
      return value.replace(needle, replace);
    }
    if (Array.isArray(value)) return value.map((item) => edit(item));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [field, item] of Object.entries(value as Record<string, unknown>)) out[field] = edit(item, field);
      return out;
    }
    return value;
  };
  const next = edit(node) as CardNode;
  if (!used || next.type !== node.type) return undefined;
  return keepShownComponent(node, next) === node ? undefined : next;
}

function statedNumbers(text: string): string[] {
  const bare = text.replace(/\s*\[(?:\d+\s*,\s*)*\d+\]/g, ' ');
  return [...bare.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

/** A new number in the edit has to be one the sources or the card already state. */
export function editIsGrounded(replace: string, corpus: string): boolean {
  return statedNumbers(replace).every((num) => corpus.includes(num));
}

/**
 * After the card is on screen: one model read, then a substring edit of the one wrong component.
 * A missing fact gets one search, then the same edit. Any failure leaves the card as it was shown.
 */
export async function reviewComponents(
  args: {
    query: string;
    results: SearchResult[];
    pages?: { n: number; text: string }[];
    head?: Omit<AnswerCard, 'body'>;
    nodes: Map<number, CardNode>;
  },
  env: Env,
  search?: (query: string) => Promise<SearchResult[]>,
  timeoutMs = 3500,
): Promise<{ index: number; node: CardNode } | undefined> {
  if (!hasLlm(env) || !args.nodes.size) return undefined;
  const indices = new Set(args.nodes.keys());
  const corpusOf = (extra: SearchResult[] = []) => [
    ...args.results.map((row) => `${row.title ?? ''} ${row.snippet ?? ''} ${row.content ?? ''}`),
    ...(args.pages ?? []).map((page) => page.text),
    ...extra.map((row) => `${row.title ?? ''} ${row.snippet ?? ''} ${row.content ?? ''}`),
    ...[...args.nodes.values()].map((node) => JSON.stringify(node)),
  ].join('\n');
  const ask = async (extra: SearchResult[] = []) => {
    const user = [
      `Asked: ${args.query}`,
      `Results:\n${[...args.results, ...extra].slice(0, BRIEF_ROWS).map((row, index) => rowLine(row, index, false)).join('\n')}`,
      args.pages?.length ? `Page text:\n${args.pages.slice(0, 4).map((page) => `[${page.n}] ${page.text.replace(/\s+/g, ' ').slice(0, 900)}`).join('\n')}` : '',
      `CARD\n${cardText(args.head, args.nodes)}`,
    ].filter(Boolean).join('\n');
    const call = llmJson<RawPrecision>(env, PRECISION, user, 500).catch(() => undefined);
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs));
    return readPrecision(await Promise.race([call, timeout]), indices);
  };
  try {
    let fix = await ask();
    if (!fix) return undefined;
    let extra: SearchResult[] = [];
    if (fix.search && search) {
      extra = (await search(fix.search).catch(() => [])).slice(0, 4);
      const again = await ask(extra);
      if (again && !again.search) fix = again;
    }
    const node = args.nodes.get(fix.index);
    if (!node) return undefined;
    if (!editIsGrounded(fix.replace, corpusOf(extra))) return undefined;
    const next = applyTextEdit(node, fix.find, fix.replace);
    if (!next) return undefined;
    return { index: fix.index, node: next };
  } catch (err) {
    console.log(JSON.stringify({ zo: 'precision-review', failed: String(err).slice(0, 120) }));
    return undefined;
  }
}
