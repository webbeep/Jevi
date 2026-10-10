import type { SearchResult } from '../shared/types';
import type { EntityChoice } from './entity';
import { hasLlm, llmJson } from './llm';
import type { Env } from './util';

const SYSTEM = `You sort web search results about a name into the distinct real people they describe, so the searcher can pick the one they mean.
Reply as JSON: {"people":[{"name": string, "who": string, "rows": number[], "query": string}]}
- name: the person's full name as the results write it (e.g. "Ricky Gervais" for the name "Ricky").
- who: 3-8 words that tell this person apart at a glance: field or role plus employer, place or best-known work, e.g. "Oncologist, Montefiore cancer center director" or "EPA regional deputy administrator". No name, no filler.
- rows: the result numbers about this person. A result belongs to one person at most; leave out results that name nobody clearly.
- query: a web search that finds this person: their name as the results write it plus 1-3 distinguishing words.
- Results about the same person (same field and employer, or one page calling them by a nickname) are one entry. Different fields, employers or countries are different people unless a result links them.
- A directory, a people-search page, or "professionals named X" is not a person. A company is not a person. Leave those out.
- Most covered first. At most 5 people.`;

interface Raw {
  people?: { name?: unknown; who?: unknown; rows?: unknown; query?: unknown }[];
}

/** The model's full name for the person when it keeps every word of the asked name; the asked name otherwise. */
function fullName(raw: unknown, asked: string): string {
  const full = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  const has = new Set(full.toLowerCase().split(/[^a-z0-9'-]+/));
  const nameLike = full.split(' ').length <= 5 && !/\b(who|whos|who's|what|is|was|the)\b/i.test(full);
  return nameLike && asked.toLowerCase().split(/\s+/).every((w) => has.has(w)) ? full : asked;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Parses the model's grouping into choices over `rows` (1-based in the reply, 0-based seeds).
 * Undefined unless it names at least `min` people, each with its own rows and a search that keeps the surname.
 */
export function readPeople(raw: Raw | undefined, name: string, count: number, min = 2): EntityChoice[] | undefined {
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
    if (/\b(professionals|people|profiles|users|persons|accounts|members)\s+named\b|\bpeople search\b/i.test(`${descriptor} ${query}`)) continue;
    seeds.forEach((i) => taken.add(i));
    const full = fullName(p.name, name);
    out.push({ name: full, descriptor, query, id: slug(`${full} ${descriptor}`), seeds });
    if (out.length === 5) break;
  }
  return out.length >= min ? out : undefined;
}

/**
 * A name shared by several people: let the model split the kept rows into people, which reads messy
 * snippets ("Edward “Ed” Chu, MD", "Ed CHU | Dr Edward Y.W. Chu") far better than the signal heuristics.
 * Undefined when there is no model, it is slow, or it finds fewer than two people.
 */
export async function splitPeople(name: string, rows: SearchResult[], env: Env, opts: { timeoutMs?: number; exclude?: string; min?: number } = {}): Promise<EntityChoice[] | undefined> {
  const { timeoutMs = 2500, exclude, min = 2 } = opts;
  if (!hasLlm(env) || rows.length < min) return undefined;
  const list = rows
    .slice(0, 20)
    .map((r, i) => `${i + 1}. ${r.title} — ${r.domain}\n   ${(r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');
  const skip = exclude ? `\nThe searcher said they do NOT mean this person, so leave them and their results out: ${exclude}` : '';
  const call = llmJson<Raw>(env, SYSTEM, `Name: ${name}${skip}\nResults:\n${list}`, 500).catch(() => undefined);
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  const people = readPeople(await Promise.race([call, timeout]), name, Math.min(rows.length, 20), min);
  return exclude ? notRejected(people, exclude, min) : people;
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/** The model sometimes lists the person just turned down anyway; "Ricky Martin — singer" drops every Ricky Martin choice. */
export function notRejected(people: EntityChoice[] | undefined, rejected: string, min = 1): EntityChoice[] | undefined {
  const who = nameKey(rejected.split(/\s+[—–-]\s+/)[0] ?? '');
  if (!people || who.split(' ').length < 2) return people;
  const kept = people.filter((p) => nameKey(p.name) !== who);
  return kept.length >= min ? kept : undefined;
}
