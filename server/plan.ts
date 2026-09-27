import type { FollowupMode, LayoutPlan } from '../shared/card';
import { askJev, choice, jevKey, noul, score } from './jev';
import { PATTERNS, heuristicPattern, patternById, skeletonCard } from './patterns';
import type { Env } from './util';

const DEPTHS = ['brief', 'standard', 'detailed'] as const;

const MODES: Record<FollowupMode, string> = {
  refine: 'Asks to change a card already on screen: a different unit, time range, focus, audience, amount, layout or level of detail',
  answer: 'Asks for more facts about the same topic that the web results already gathered can answer',
  chat: 'Needs thinking rather than looking up: explaining, reasoning, advice for their situation, opinions, planning, comparing trade-offs, calculations, rewriting, or anything answerable from the conversation and general knowledge',
  search: 'Needs new or current facts from the web that the conversation does not have: a different topic, recent events, prices, availability, specific data',
};

export interface PlanContext {
  /** The search that started the conversation (follow-ups only). */
  original?: string;
  /** Cards on screen, newest last, so a refine can name its target. */
  cards?: { id: number; title: string }[];
  /** Compact summary of earlier turns. */
  context?: string;
}

export async function planLayout(query: string, env: Env, ctx: PlanContext = {}): Promise<LayoutPlan> {
  const started = Date.now();
  const { original, cards = [], context = '' } = ctx;
  const fallback = (): LayoutPlan => {
    const pattern = heuristicPattern(query);
    return {
      query,
      pattern,
      alternatives: [patternById(pattern), ...PATTERNS.filter((p) => p.id !== pattern).slice(0, 2)].map(({ id, label, description }) => ({ id, label, description })),
      skeleton: skeletonCard(query, pattern),
      engine: 'heuristic',
      confidence: 0.5,
      depth: 'standard',
      readPages: heuristicPattern(query) === 'spotlight' || heuristicPattern(query) === 'dataset',
      mode: original ? 'chat' : undefined,
      think: false,
      ms: Date.now() - started,
    };
  };
  if (!jevKey(env)) return fallback();

  try {
    const state = original
      ? `A person is in a conversation with an assistant that can both search the web and think. It started with the search "${original}".${context ? `\nConversation so far:\n${context}` : ''}\nThey now wrote: "${query}".`
      : `Someone typed this into a search engine: "${query}". Before any results load, decide how the answer card should be laid out so the answer is instantly readable at a glance.`;
    const answers = await askJev(env, state, {
      ...(original
        ? {
            mode: { type: 'choice' as const, instructions: 'What does answering this message need?', criteria: MODES },
            think: { type: 'noul' as const, instructions: 'Answering well needs careful multi-step reasoning (maths, planning, weighing several constraints, debugging), not just recalling or summarising.' },
          }
        : {}),
      ...(original && cards.length > 1
        ? { target: { type: 'choice' as const, instructions: 'If this asks to change a card on screen, which card does it refer to?', criteria: Object.fromEntries(cards.slice(-8).map((c) => [`c${c.id}`, c.title])) } }
        : {}),
      pattern: {
        type: 'choice',
        instructions: 'Which card layout fits the answer this person expects?',
        criteria: Object.fromEntries(PATTERNS.map((p) => [p.id, p.description])),
      },
      depth: {
        type: 'score',
        instructions: 'How much detail does the person want?',
        criteria: ['A glance is enough', 'A normal amount of detail', 'A thorough, detailed answer'],
      },
      needs_pages: {
        type: 'noul',
        instructions: 'A good answer needs precise figures, current readings, specs, prices or step details that short search-result snippets usually leave out.',
      },
    });
    const pick = choice(answers, 'pattern');
    if (!pick) return fallback();
    const ranked = Object.entries(pick.probabilities).sort((a, b) => b[1] - a[1]).map(([id]) => patternById(id));
    const depthScore = score(answers, 'depth') ?? 1;
    return {
      query,
      pattern: pick.choice,
      alternatives: ranked.slice(0, 3).map(({ id, label, description }) => ({ id, label, description })),
      skeleton: skeletonCard(query, pick.choice),
      engine: 'jev',
      confidence: pick.confidence,
      depth: DEPTHS[Math.max(0, Math.min(2, Math.round(depthScore)))],
      readPages: noul(answers, 'needs_pages') >= 0.5,
      mode: original ? ((choice(answers, 'mode')?.choice as FollowupMode | undefined) ?? 'chat') : undefined,
      think: original ? noul(answers, 'think') >= 0.6 : false,
      target: Number(choice(answers, 'target')?.choice.slice(1)) || undefined,
      ms: Date.now() - started,
    };
  } catch (err) {
    console.error('Jev plan failed', err);
    return fallback();
  }
}
