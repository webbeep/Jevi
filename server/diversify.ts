/**
 * Source diversity for the merged result list (no I/O, no imports, so unit tests can load it directly).
 *
 * 1. Results on a site the person named ("Google Workspace" -> workspace.google.com, "PostgreSQL" ->
 *    postgresql.org) go first, at most `named` of them, in their original order.
 * 2. Every other domain keeps at most `perDomain` places up front. Its extra results keep their order
 *    but move behind everything else, so one site can't fill the first screen (who.int took 5 of the
 *    top 5 for the WHO question). The named site is never capped.
 * Nothing is dropped: the list has the same members, only the order changes.
 */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'how', 'what', 'why', 'when', 'who', 'are', 'vs', 'best', 'does', 'can', 'find', 'give',
  'source', 'official', 'page', 'this', 'that', 'from', 'real', 'which', 'should', 'buy', 'get',
]);
/** Host labels that say nothing about whose site it is. */
const GENERIC = new Set([
  'com', 'org', 'net', 'www', 'edu', 'gov', 'int', 'docs', 'support', 'help', 'blog', 'news', 'app', 'web', 'online',
  'site', 'info', 'store', 'shop', 'deals', 'review', 'reviews', 'guide', 'tech',
]);

/** True for a domain with a label that is a word the person typed (3+ letters, not a stop or generic word). */
export function namedSite(query: string): (domain: string) => boolean {
  const words = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
  return (domain) => domain.toLowerCase().split(/[.-]/).some((p) => p.length > 2 && !GENERIC.has(p) && words.has(p));
}

export function diversify<T extends { domain: string }>(query: string, rows: readonly T[], perDomain = 2, named = 3): T[] {
  const isNamed = namedSite(query);
  const front: T[] = [];
  const head: T[] = [];
  const tail: T[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const own = isNamed(r.domain);
    if (own && front.length < named) {
      front.push(r);
      continue;
    }
    const n = (seen.get(r.domain) ?? 0) + 1;
    seen.set(r.domain, n);
    (own || n <= perDomain ? head : tail).push(r);
  }
  return [...front, ...head, ...tail];
}
