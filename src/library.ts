import type { AnswerCard } from '../shared/card';
import type { SearchResult } from '../shared/types';
import type { Turn } from './useSession';

/** One source in the conversation-wide list. */
export interface LibraryEntry {
  result: SearchResult;
  /** The search turn it came from (first one, if several found it). */
  searchId: number;
  /** Turn ids of the cards that cite it. */
  citedBy: number[];
}

const citedCache = new WeakMap<AnswerCard, number[]>();

/** Source numbers ([n] markers and citations nodes) a card refers to. Cards are immutable, so results are cached. */
export function citedRefs(card: AnswerCard): number[] {
  let out = citedCache.get(card);
  if (!out) citedCache.set(card, (out = scanRefs(card)));
  return out;
}

function scanRefs(card: AnswerCard): number[] {
  const refs = new Set<number>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\[(\d+)\]/g)) refs.add(Number(m[1]));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'citations' && Array.isArray(o.refs)) o.refs.forEach((r) => typeof r === 'number' && refs.add(r));
      else Object.values(o).forEach(walk);
    }
  };
  walk(card.body);
  return [...refs].filter((n) => n >= 1).sort((a, b) => a - b);
}

/** The card a turn currently shows, finished or still streaming. */
const cardOf = (t: Turn): AnswerCard | undefined => t.result?.card;

/**
 * Every source the conversation has gathered, merged across searches (follow-up
 * searches add to it) and ranked: cited by more cards first, then found by more
 * engines, then by its rank in the search that found it.
 */
export function buildLibrary(turns: Turn[]): LibraryEntry[] {
  const byUrl = new Map<string, LibraryEntry & { rank: number; order: number }>();
  let order = 0;
  for (const t of turns) {
    if (t.searchId !== t.id || !t.search) continue;
    t.search.results.forEach((result, rank) => {
      const prev = byUrl.get(result.url);
      if (prev) {
        prev.rank = Math.min(prev.rank, rank);
        if (result.engines.length > prev.result.engines.length || (!prev.result.content && result.content)) prev.result = { ...result, content: result.content ?? prev.result.content };
      } else byUrl.set(result.url, { result, searchId: t.id, citedBy: [], rank, order: order++ });
    });
  }
  const searches = new Map(turns.map((t) => [t.id, t]));
  for (const t of turns) {
    const card = cardOf(t);
    const results = searches.get(t.searchId)?.search?.results;
    if (!card || !results) continue;
    for (const n of citedRefs(card)) {
      const entry = results[n - 1] && byUrl.get(results[n - 1].url);
      if (entry && !entry.citedBy.includes(t.id)) entry.citedBy.push(t.id);
    }
  }
  const score = (e: LibraryEntry & { rank: number }) => e.citedBy.length * 10 + Math.min(e.result.engines.length, 4) + 6 / (e.rank + 1);
  return [...byUrl.values()]
    .sort((a, b) => score(b) - score(a) || a.order - b.order)
    .map(({ result, searchId, citedBy }) => ({ result, searchId, citedBy }));
}
