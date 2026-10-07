/**
 * Function words, question words, and vague fillers that do not name a topic.
 */
const STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'and', 'or', 'but', 'if', 'as',
  'is', 'are', 'was', 'were', 'be', 'am', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'have', 'has', 'had', 'it', 'its', 'this', 'that', 'my', 'your', 'our', 'me', 'you', 'i',
  'who', 'what', 'when', 'where', 'why', 'how', 'which',
  'about', 'into', 'over', 'than', 'then', 'not', 'no', 'so', 'just', 'very',
  'now', 'vs', 'versus',
]);

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)))];
}

/**
 * True when an encyclopedia or instant-answer entry is about the query.
 * Every title word outside a parenthetical qualifier must appear in the query.
 * Words inside the qualifier count toward coverage but are not required in the query.
 * Strictly more than half of the query's remaining words must appear in the
 * title (including its qualifier) or the description.
 */
export function knowledgeMatches(query: string, title: string, description?: string): boolean {
  const qualifierWords = words([...title.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(' '));
  const titleWords = words(title.replace(/\s*\([^)]*\)/g, ' '));
  const queryWords = words(query);
  if (!titleWords.length || !queryWords.length) return false;
  const querySet = new Set(queryWords);
  if (!titleWords.every((w) => querySet.has(w))) return false;
  const coveredBy = new Set([...titleWords, ...qualifierWords, ...words(description ?? '')]);
  return queryWords.filter((w) => coveredBy.has(w)).length / queryWords.length > 0.5;
}
