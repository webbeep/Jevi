/**
 * A follow-up label is the follow-up the user asked.
 * A search that glues the previous query on does not replace those words.
 */
/**
 * The bubble is the person they chose. A search that prepends someone else is ignored.
 * A search that drops a glued name shows the name that remains.
 */
/**
 * The "Showing results for" line. A spacing or capital change that is still the same
 * product can show. A different word (one letter swapped for another brand) does not.
 */
export function visibleSpelling(typed: string, proposed: string | undefined): string | undefined {
  const shown = proposed?.trim();
  const ask = typed.trim();
  if (!shown || shown.toLowerCase() === ask.toLowerCase()) return undefined;
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (letters(ask) === letters(shown)) return shown;
  const left = ask.split(/\s+/);
  const right = shown.split(/\s+/);
  if (left.length !== right.length) return undefined;
  const oneTypo = (a: string, b: string) => {
    if (Math.abs(a.length - b.length) !== 1) return false;
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    let i = 0;
    let j = 0;
    let skipped = 0;
    while (i < shorter.length && j < longer.length) {
      if (shorter[i] === longer[j]) {
        i += 1;
        j += 1;
      } else {
        skipped += 1;
        j += 1;
        if (skipped > 1) return false;
      }
    }
    return skipped + (longer.length - j) <= 1;
  };
  const differentWord = left.some((word, i) => {
    const a = letters(word);
    const b = letters(right[i] ?? '');
    return a.length >= 4 && b.length >= 4 && a !== b && !oneTypo(a, b);
  });
  return differentWord ? undefined : shown;
}

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
