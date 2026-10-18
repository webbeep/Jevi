const LEAD = new Set(['what', 'whats', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'which', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'if', 'tell', 'show', 'give', 'the', 'and', 'for', 'from', 'not']);
const NAME = /^(?:[A-Z]{2,}|[A-Z][a-zA-Z0-9'’.-]{2,})$/;

function bare(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

/** Capitalised names in a question, skipping a leading question word. */
export function introducedNames(question: string): string[] {
  return question.replace(/[“”"'’]/g, ' ').split(/\s+/).filter(Boolean).flatMap((raw, index) => {
    const word = bare(raw);
    if (!NAME.test(word)) return [];
    if (index === 0 && LEAD.has(word.toLowerCase())) return [];
    return [word];
  });
}

/** The question names a place or business the previous turn did not. */
export function breaksChain(question: string, prior: string): boolean {
  const hay = prior.toLowerCase();
  return introducedNames(question).some((name) => !hay.includes(name.toLowerCase()));
}

export interface ChainTurn { question: string; title?: string }

/**
 * Index of the turn that started the chain ending at `end`.
 * A later turn stays on that subject until the question names a different one.
 */
export function chainStartIndex(turns: readonly ChainTurn[], end: number): number {
  const last = Math.min(Math.max(end, 0), turns.length - 1);
  if (last < 0) return 0;
  let start = 0;
  for (let i = 1; i <= last; i++) {
    const prev = turns[i - 1]!;
    const prior = `${prev.question} ${prev.title ?? ''}`;
    if (breaksChain(turns[i]!.question, prior)) start = i;
  }
  return start;
}
