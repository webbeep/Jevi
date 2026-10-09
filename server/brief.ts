import type { SearchResult } from '../shared/types';
import { hasLlm, llmJson } from './llm';
import { normalizeUrl } from './search';
import type { Env } from './util';

/** Sources the designer sees, numbered the same way (see `sourcesBlock`). */
export const BRIEF_ROWS = 12;

/**
 * What a right answer to this ask needs, judged before the card is written: which sources answer
 * the goal as of today, which are outdated or about something else, and where they disagree.
 */
export interface SourceBrief {
  goal: string;
  use: number[];
  stale: number[];
  offTopic: number[];
  conflicts: string[];
  /** What the person asked that no source answers. */
  missing?: string;
  /** Some of the sources the card is written from were not judged (they arrived after the check ran). */
  partial?: boolean;
}

/** A brief judged on `judged` (an early subset of the rows), renumbered for the rows the card is written from. */
export function remapBrief(brief: SourceBrief, judged: SearchResult[], results: SearchResult[]): SourceBrief {
  const at = new Map(results.slice(0, BRIEF_ROWS).map((r, i) => [normalizeUrl(r.url), i + 1]));
  const map = (ns: number[]) => ns.flatMap((n) => {
    const row = judged[n - 1];
    const to = row && at.get(normalizeUrl(row.url));
    return to ? [to] : [];
  });
  const seen = new Set(judged.map((r) => normalizeUrl(r.url)));
  const partial = [...at.keys()].some((url) => !seen.has(url));
  const conflicts = brief.conflicts.flatMap((c) => {
    let lost = false;
    const text = c.replace(/\[(\d+)\]/g, (_, n: string) => {
      const [to] = map([Number(n)]);
      if (!to) lost = true;
      return `[${to}]`;
    });
    return lost ? [] : [text];
  });
  return {
    goal: brief.goal,
    use: map(brief.use),
    stale: map(brief.stale),
    offTopic: map(brief.offTopic),
    conflicts,
    missing: partial ? undefined : brief.missing,
    ...(partial ? { partial } : {}),
  };
}

const SYSTEM = `You check web search results before an assistant answers from them. Judge them against what the person actually wants, today's date and the conversation.
Reply as JSON: {"goal": string, "use": number[], "stale": number[], "offTopic": number[], "conflicts": string[], "missing": string}
- goal: one sentence naming what a right answer must give (e.g. "Bitcoin's current USD price and today's move", "Who Ed Chu of BlueFlame AI is and his role"). Use the conversation to resolve references.
- use: result numbers that directly answer the goal and are current enough for it, best first.
- stale: results whose information is outdated for this goal: an old price, last season's stats, a superseded version, news older than the ask allows. Judge by the result's date and content against today's date. An evergreen fact (a definition, a birth date) is not stale. For a "today" or "latest" ask, the past 36 hours count as today.
- offTopic: results about something else: another person or company with the same name, a different product, place or time period, or results that only share words with the ask.
- conflicts: at most 3 short notes where results disagree on a fact that matters, naming the results and their dates, e.g. "[3] says 71,360 on Jun 2; live quote [1] says 82,290".
- missing: what the person asked that no result answers, or "" when the results cover it.
- A result marked LIVE is real-time data fetched seconds ago: it beats any other result on the current value.
Be strict: a result that is only loosely related is not in "use".`;

interface Raw {
  goal?: unknown;
  use?: unknown;
  stale?: unknown;
  offTopic?: unknown;
  conflicts?: unknown;
  missing?: unknown;
}

const nums = (v: unknown, count: number): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count))] : [];

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function readBrief(raw: Raw | undefined, count: number): SourceBrief | undefined {
  const goal = text(raw?.goal, 200);
  if (!raw || !goal) return undefined;
  const use = nums(raw.use, count);
  const offTopic = nums(raw.offTopic, count).filter((n) => !use.includes(n));
  const stale = nums(raw.stale, count).filter((n) => !use.includes(n) && !offTopic.includes(n));
  const conflicts = Array.isArray(raw.conflicts) ? raw.conflicts.map((c) => text(c, 200)).filter(Boolean).slice(0, 3) : [];
  const missing = text(raw.missing, 200) || undefined;
  return { goal, use, stale, offTopic, conflicts, missing };
}

/** Sources the card must not take facts or numbers from, unless that would leave nothing to answer from. */
export function rejectedSources(brief: SourceBrief | undefined, count: number): Set<number> {
  if (!brief) return new Set();
  const rejected = new Set([...brief.stale, ...brief.offTopic]);
  const kept = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !rejected.has(n));
  return kept.length ? rejected : new Set();
}

export function rowLine(r: SearchResult, i: number, live: boolean): string {
  const snippet = (r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 260);
  return `[${i + 1}]${live ? ' LIVE' : ''} ${r.title} (${r.domain}${r.date ? `, ${r.date.slice(0, 10)}` : ', undated'}): ${snippet}`;
}

export async function briefSources(
  args: { query: string; intent?: string; context?: string; results: SearchResult[]; isLive: (r: SearchResult) => boolean; shown?: string },
  env: Env,
  timeoutMs = 1800,
): Promise<SourceBrief | undefined> {
  const rows = args.results.slice(0, BRIEF_ROWS);
  if (!hasLlm(env) || rows.length < 2) return undefined;
  const user = [
    `Today is ${new Date().toISOString().slice(0, 10)} (UTC).`,
    args.context ? `Conversation so far:\n${args.context.slice(0, 1200)}` : '',
    `Asked: ${args.query}`,
    args.intent ? `Read as: ${args.intent}` : '',
    args.shown ? `Already on the card, outside these results (never "missing"): ${args.shown}` : '',
    `Results:\n${rows.map((r, i) => rowLine(r, i, args.isLive(r))).join('\n')}`,
  ].filter(Boolean).join('\n');
  const call = llmJson<Raw>(env, SYSTEM, user, 400).catch((err) => {
    console.log(JSON.stringify({ zo: 'brief', failed: String(err).slice(0, 120) }));
    return undefined;
  });
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  return readBrief(await Promise.race([call, timeout]), rows.length);
}
