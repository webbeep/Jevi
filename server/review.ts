import type { AnswerCard, CardNode } from '../shared/card';
import type { SearchResult } from '../shared/types';
import { BRIEF_ROWS, rowLine, type SourceBrief } from './brief';
import { hasLlm, llmJson } from './llm';
import type { Env } from './util';

/**
 * After the card is written and before it is saved: one model read of the finished card against the goal,
 * today's date, the conversation and the sources. Wrong nodes are rewritten in place; a problem the
 * sources can't fix becomes a warning above the answer instead of a confident wrong card.
 */
const SYSTEM = `You review an answer card before it is saved, like a careful editor checking facts. Judge it against what the person wants, today's date, the conversation and the search results.
Flag only real errors that would mislead the reader:
- it does not answer the goal, or answers a different question;
- it is about the wrong subject (a namesake, another company, product, place or period);
- it presents an old value or old news as current (check dates against today), or contradicts a LIVE result or newer results;
- a stated fact, number or date is not supported by the results, or is attributed to the wrong thing;
- it carries over facts from the conversation that belong to a different subject;
- two nodes show the same fact, number or chart (fix the later one with something else the results support, or a short text node).
Style, wording, layout and missing nice-to-haves are not errors. For a "today" or "latest" ask, anything from the past 36 hours is current: don't flag it, and don't warn that nothing is dated exactly today.
Reply as JSON: {"verdict":"ok"|"fix","problems":[string],"fixes":[{"node":number,"replace":object}],"note":string}
- problems: one short line per error, naming the node number.
- fixes: for each wrong node you can correct from the results, a full replacement node in the same JSON shape as the original (same "type" when possible), with facts only from the results and citations like [2]. At most 3.
- note: when the card is misleading and the results can't fix it (e.g. no current figure, wrong person), one plain sentence telling the reader what is uncertain; otherwise "".
- verdict "ok" with empty problems, fixes and note when the card is right.`;

interface Raw {
  verdict?: unknown;
  problems?: unknown;
  fixes?: unknown;
  note?: unknown;
}

export interface Review {
  ok: boolean;
  problems: string[];
  fixes: { index: number; node: unknown }[];
  note?: string;
}

const NODE_CHARS = 900;
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
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().replace(/\s+/g, ' ').slice(0, 240) : undefined;
  const ok = raw.verdict === 'ok' || (!fixes.length && !note);
  return { ok, problems, fixes: ok ? [] : fixes, note: ok ? undefined : note };
}

/** Top-level nodes as the reviewer reads them; actions, citations and pictures carry no claims. */
function cardText(head: Omit<AnswerCard, 'body'> | undefined, nodes: Map<number, CardNode>): string {
  const lines = [`Title: ${head?.title ?? ''}${head?.subtitle ? ` — ${head.subtitle}` : ''}`];
  let used = 0;
  for (const [index, node] of [...nodes].sort((a, b) => a[0] - b[0])) {
    if (node.type === 'actions' || node.type === 'citations' || node.type === 'gallery' || node.type === 'image' || node.type === 'video') continue;
    const json = JSON.stringify(node).slice(0, NODE_CHARS);
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
    isLive: (r: SearchResult) => boolean;
    head?: Omit<AnswerCard, 'body'>;
    nodes: Map<number, CardNode>;
  },
  env: Env,
  timeoutMs = 4000,
): Promise<Review | undefined> {
  if (!hasLlm(env) || !args.nodes.size) return undefined;
  const user = [
    `Today is ${new Date().toISOString().slice(0, 10)} (UTC).`,
    args.context ? `Conversation so far:\n${args.context.slice(0, 1200)}` : '',
    `Asked: ${args.query}`,
    args.brief ? `Goal: ${args.brief.goal}` : '',
    args.brief?.stale.length ? `Outdated results: ${args.brief.stale.map((n) => `[${n}]`).join(' ')}` : '',
    args.brief?.offTopic.length ? `Off-topic results: ${args.brief.offTopic.map((n) => `[${n}]`).join(' ')}` : '',
    `Results:\n${args.results.slice(0, BRIEF_ROWS).map((r, i) => rowLine(r, i, args.isLive(r))).join('\n')}`,
    `CARD\n${cardText(args.head, args.nodes)}`,
  ].filter(Boolean).join('\n');
  const call = llmJson<Raw>(env, SYSTEM, user, 1200).catch((err) => {
    console.log(JSON.stringify({ zo: 'review', failed: String(err).slice(0, 120) }));
    return undefined;
  });
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  return readReview(await Promise.race([call, timeout]), new Set(args.nodes.keys()));
}
