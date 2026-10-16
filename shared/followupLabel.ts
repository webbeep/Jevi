/**
 * A follow-up label is the follow-up the user asked.
 * A search that glues the previous query on does not replace those words.
 */
export function followupLabel(asked: string, rewritten: string): string {
  const typed = asked.trim();
  const next = rewritten.trim();
  if (!typed) return next;
  const lowTyped = typed.toLowerCase();
  const lowNext = next.toLowerCase();
  if (lowNext === lowTyped || lowNext.endsWith(lowTyped) || lowNext.startsWith(`${lowTyped} `)) return typed;
  return next;
}
