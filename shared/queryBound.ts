/**
 * Safety cap for a question that is searched or shown.
 * Well above a normal long question: a paragraph still fits, and anything longer
 * ends on the last complete word. A partial word is never the question.
 */
export const ASK_MAX = 2000;

/** The question, whole, up to `max` characters, cut on a word boundary when it is longer. */
export function boundAsk(text: string, max = ASK_MAX): string {
  const q = text.replace(/\s+/g, ' ').trim();
  if (q.length <= max) return q;
  const at = q.lastIndexOf(' ', max);
  return at > 0 ? q.slice(0, at).trim() : '';
}
