import { askedQuestions, isPersonAsk, personSubject, priorEntity } from './entity';

export type PersonSteer = { kind: 'reject' } | { kind: 'narrow'; detail: string };

const REJECT = /\b(not (?:this|that|him|her|them|the (?:right|same) (?:one|person|guy))|not who i (?:meant|mean|want)|wrong (?:person|one|guy|man|woman|profile)|(?:a )?different (?:one|person|guy)|someone else|somebody else|another (?:one|person)|the other one)\b/i;
const NARROW = [
  /\b(?:the one |the guy |the person |who |he |she |they )?(?:is |was |works? |worked )?(?:from|at|with|for)\s+(.{2,60}?)[.!?]*\s*$/i,
  /\bthe (.{2,40}?) one[.!?]*\s*$/i,
];
/** "a different Ed Chu", "another John Smith": case-sensitive, so "a different layout" is not a rejection. */
const OTHER_NAMED = /\b(?:[Dd]ifferent|[Aa]nother|[Oo]ther) [A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?/;
const QUESTION = /^(what|how|why|when|where|which|is|are|was|were|does|did|do|can|could|tell|show|explain|list|give)\b/i;
const FILLER = /^(the|a|an|this|that|him|her|them|one|person|guy|here|there|it|me)$/i;

/**
 * A follow-up in a person thread that says the card is about the wrong person ("not this", "wrong one")
 * or names who they meant ("from BlueFlame AI", "the one at Google", "the Revco one").
 * Undefined for anything else, which goes through the normal rewrite.
 */
export function personSteer(question: string): PersonSteer | undefined {
  const q = question.trim();
  if (!q || q.split(/\s+/).length > 14) return undefined;
  // "what did he do at Montefiore?" asks about the person on screen; it does not pick another one.
  const asking = q.endsWith('?') || QUESTION.test(q);
  for (const re of asking ? [] : NARROW) {
    const detail = re.exec(q)?.[1]?.trim().replace(/^(the|a|an)\s+/i, '');
    if (detail && !FILLER.test(detail) && !REJECT.test(detail)) return { kind: 'narrow', detail };
  }
  return REJECT.test(q) || OTHER_NAMED.test(q) ? { kind: 'reject' } : undefined;
}

/**
 * The name a thread asked about: the first ask when it named someone, else the thread's chosen person.
 * A first name alone counts ("Who's Ricky" asked about anyone called Ricky; the Ricky Cheuk on the card
 * was only one pick), so "not this" offers the other Rickys rather than namesakes of the one on screen.
 */
export function threadPerson(original: string, context?: string): string {
  for (const ask of [original, ...askedQuestions(context).reverse()]) {
    if (isPersonAsk(ask)) {
      const name = personSubject(ask);
      if (name.split(/\s+/).length >= 2 || /^[A-Z][a-z]/.test(name)) return name;
    }
  }
  return priorEntity(context)?.name ?? '';
}

/** Conversation context without the earlier `Chosen person:` lock, which named the person now ruled out. */
export const withoutChosen = (context?: string) => context?.replace(/^Chosen person:.*$\n?/gm, '').trim() || undefined;

/**
 * Context for a search about a newly picked person: the thread's topic line only. Earlier cards
 * describe whoever was on screen before, and a card writer short of sources borrows their facts.
 */
export const topicOnly = (context?: string) => context?.split('\n').find((line) => line.startsWith('Topic:'))?.trim() || undefined;
