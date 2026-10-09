import type { SearchResult } from '../shared/types';
import type { EntityChoice } from './entity';
import { hasLlm, llmJson } from './llm';
import type { Env } from './util';

const SYSTEM = `You sort web search results about a name into the distinct real people they describe, so the searcher can pick the one they mean.
Reply as JSON: {"people":[{"who": string, "rows": number[], "query": string}]}
- who: 3-8 words that tell this person apart at a glance: field or role plus employer, place or best-known work, e.g. "Oncologist, Montefiore cancer center director" or "EPA regional deputy administrator". No name, no filler.
- rows: the result numbers about this person. A result belongs to one person at most; leave out results that name nobody clearly.
- query: a web search that finds this person: their name as the results write it plus 1-3 distinguishing words.
- Results about the same person (same field and employer, or one page calling them by a nickname) are one entry. Different fields, employers or countries are different people unless a result links them.
- Most covered first. At most 5 people.`;

interface Raw {
  people?: { who?: unknown; rows?: unknown; query?: unknown }[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Parses the model's grouping into choices over `rows` (1-based in the reply, 0-based seeds).
 * Undefined unless it names at least two people, each with its own rows and a search that keeps the surname.
 */
export function readPeople(raw: Raw | undefined, name: string, count: number): EntityChoice[] | undefined {
  const surname = name.trim().split(/\s+/).at(-1)?.toLowerCase() ?? '';
  const taken = new Set<number>();
  const out: EntityChoice[] = [];
  for (const p of raw?.people ?? []) {
    if (typeof p.who !== 'string' || typeof p.query !== 'string' || !Array.isArray(p.rows)) continue;
    const seeds = p.rows
      .filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count && !taken.has(n - 1))
      .map((n) => n - 1);
    const descriptor = p.who.trim().replace(/\s+/g, ' ').slice(0, 60);
    const query = p.query.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!seeds.length || !descriptor || !query.toLowerCase().includes(surname)) continue;
    seeds.forEach((i) => taken.add(i));
    out.push({ name, descriptor, query, id: slug(`${name} ${descriptor}`), seeds });
    if (out.length === 5) break;
  }
  return out.length >= 2 ? out : undefined;
}

/**
 * A name shared by several people: let the model split the kept rows into people, which reads messy
 * snippets ("Edward “Ed” Chu, MD", "Ed CHU | Dr Edward Y.W. Chu") far better than the signal heuristics.
 * Undefined when there is no model, it is slow, or it finds fewer than two people.
 */
export async function splitPeople(name: string, rows: SearchResult[], env: Env, timeoutMs = 2500): Promise<EntityChoice[] | undefined> {
  if (!hasLlm(env) || rows.length < 2) return undefined;
  const list = rows
    .slice(0, 20)
    .map((r, i) => `${i + 1}. ${r.title} — ${r.domain}\n   ${(r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');
  const call = llmJson<Raw>(env, SYSTEM, `Name: ${name}\nResults:\n${list}`, 500).catch(() => undefined);
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  return readPeople(await Promise.race([call, timeout]), name, Math.min(rows.length, 20));
}
