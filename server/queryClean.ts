/** Qualifiers a rewriter tacks on; they make MediaWiki's all-terms search miss. */
const TRAILING = new Set([
  'standout', 'standouts', 'highlights', 'analysis', 'report', 'recap', 'review', 'preview',
  'takeaways', 'performance', 'breakdown', 'update', 'latest', 'news', 'rumors', 'stats',
]);

const TRAIL_PUNCT = /[),.;:!?]+$/;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** A phrase of 2+ words said twice in a row once: "Blueflame AI Blueflame AI at Datasite" -> "Blueflame AI at Datasite". */
function dedupePhrases(s: string): string {
  return s.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’.-]*){1,4})\s+\1(?![\p{L}\p{N}])/giu, '$1');
}

function core(token: string): string {
  return token.replace(TRAIL_PUNCT, '');
}

function isSiteFilter(token: string): boolean {
  return /^site:/i.test(core(token));
}

/** Hosts, paths, and URLs. `site:` filters are not domains to drop. */
function isDomainLike(token: string): boolean {
  const bare = core(token);
  if (!bare || isSiteFilter(bare)) return false;
  return /^(?:https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i.test(bare);
}

function withoutDomains(q: string): string {
  const kept = q.split(/\s+/).filter((token) => token && !isDomainLike(token));
  return collapse(kept.map((token) => (isSiteFilter(token) ? core(token) : token)).join(' '));
}

function cutSuffix(q: string, tail: string): string | undefined {
  const t = collapse(tail);
  if (!t) return undefined;
  const padded = ` ${q.toLowerCase()}`;
  if (!padded.endsWith(` ${t.toLowerCase()}`)) return undefined;
  const next = q.slice(0, q.length - t.length).trim();
  return next || undefined;
}

function sourceTails(title: string): string[] {
  const tails = [collapse(title)];
  const domains = title.match(/(?:https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/gi) ?? [];
  for (const domain of domains) {
    tails.push(domain);
    const host = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '';
    const site = host.split('.')[0] ?? '';
    if (site.length > 1) tails.push(site);
  }
  return tails.filter((t) => t.length > 1);
}

function stripSourceTail(q: string, sourceTitle: string): string {
  const tails = sourceTails(sourceTitle).sort((a, b) => b.length - a.length);
  for (const tail of tails) {
    const next = cutSuffix(q, tail);
    if (next) return next;
  }
  return q;
}

function tidy(q: string): string {
  return collapse(q).replace(TRAIL_PUNCT, '').trim();
}

/**
 * Drops domains a rewriter appended (unless they are a `site:` filter) and a
 * card title stuck on the end. Never returns an empty string.
 */
export function sanitizeSearchQuery(q: string, sourceTitle?: string): string {
  const input = dedupePhrases(collapse(q));
  const domainsOnly = tidy(withoutDomains(input));
  let out = domainsOnly;
  if (sourceTitle?.trim()) out = tidy(stripSourceTail(out, sourceTitle));
  if (out) return out;
  if (domainsOnly) return domainsOnly;
  return input;
}

function isEntity(word: string): boolean {
  return /^[A-Z]/.test(word) || /^\d/.test(word);
}

/** Looser query: entities and numbers, trailing filler removed, at most six words. */
export function relaxQuery(q: string): string {
  const tickers = cashtags(q);
  if (tickers.length) return `${tickers.map((t) => t.toUpperCase()).join(' ')} stock`;
  const kept = q.split(/\s+/).filter((token) => token && !isSiteFilter(token) && !isDomainLike(token));
  const words = collapse(kept.join(' '))
    .replace(/["'“”‘’()[\]{}]/g, ' ')
    .replace(/[^A-Za-z0-9\s'-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
  while (words.length && TRAILING.has(words[words.length - 1]!.toLowerCase())) words.pop();
  const entities = words.filter(isEntity);
  return (entities.length ? entities : words).slice(0, 6).join(' ');
}

/** Leading run of Capitalized words, at most four. Empty when the query does not start with one. */
export function entityQuery(q: string): string {
  const asked = q.trim().replace(/^(?:who|what|where|when|which|how)\s+(?:is|are|was|were|does|do|did)\s+(?:the\s+)?/i, '');
  const words = withoutDomains(asked.replace(/["'“”‘’()[\]{}]/g, ' '))
    .split(/\s+/)
    .filter((token) => !isSiteFilter(token))
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    if (!/^[A-Z]/.test(word)) break;
    out.push(word);
    if (out.length === 4) break;
  }
  return out.join(' ');
}

const CASHTAG = /(^|[^A-Za-z0-9])\$([A-Za-z]{1,5})(?![A-Za-z0-9])/g;

/** Stock tickers written as cashtags ("$rdw", "$NVDA"), lowercased. */
export function cashtags(query: string): string[] {
  return [...new Set([...query.matchAll(CASHTAG)].map((m) => m[2]!.toLowerCase()))];
}

/** "why $rdw dropping" → "why RDW stock dropping": engines read a bare "$rdw" as noise or a blood test. */
export function expandCashtags(query: string): string {
  if (!cashtags(query).length) return query;
  const hasStock = /\b(?:stocks?|shares?)\b/i.test(query);
  return collapse(query.replace(CASHTAG, (_, lead: string, t: string) => `${lead}${t.toUpperCase()}${hasStock ? '' : ' stock'}`));
}

/** Searches that need no model: the ticker's own news for a cashtag ask. */
export function tickerQueries(query: string): string[] {
  return cashtags(query).slice(0, 2).map((t) => `${t.toUpperCase()} stock news today`);
}
