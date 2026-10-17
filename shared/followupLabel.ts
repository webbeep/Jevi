/**
 * A follow-up label is the follow-up the user asked.
 * A search that glues the previous query on does not replace those words.
 */
/**
 * The bubble is the person they chose. A search that prepends someone else is ignored.
 * A search that drops a glued name shows the name that remains.
 */
export function followupLabel(asked: string, rewritten: string): string {
  const typed = asked.trim();
  const next = rewritten.trim();
  if (!typed) return next;
  const lowTyped = typed.toLowerCase();
  const lowNext = next.toLowerCase();
  if (lowNext !== lowTyped && lowNext.endsWith(lowTyped)) return typed;
  if (lowTyped.endsWith(lowNext)) return next;
  return typed;
}
