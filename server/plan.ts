import type { FollowupMode, LayoutPlan } from '../shared/card';
import { askJev, choice, jevKey, noul, score } from './jev';
import { PATTERNS, heuristicPattern, patternById, skeletonCard } from './patterns';
import type { Env } from './util';

const DEPTHS = ['brief', 'standard', 'detailed'] as const;

const MODES: Record<FollowupMode, string> = {
  refine: 'Changes how the current answer card is shown: a different unit, time range, focus, audience, amount or level of detail, on the same topic',
  answer: 'A new question about the same topic that the current search results can probably answer',
  search: 'A different topic, or something the current results cannot cover, so a fresh web search is needed',
};

export async function planLayout(query: string, env: Env, original?: string, cards: { id: number; title: string }[] = []): Promise<LayoutPlan> {
  const started = Date.now();
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
      timeSensitive: ['spotlight', 'briefing'].includes(heuristicPattern(query)),
      mode: original ? 'answer' : undefined,
      ms: Date.now() - started,
    };
  };
  if (!jevKey(env)) return fallback();

  try {
    const state = original
      ? `Someone searched for "${original}" and is looking at the answer card. They now typed the follow-up: "${query}". Decide how the answer to this follow-up should be laid out.`
      : `Someone typed this into a search engine: "${query}". Before any results load, decide how the answer card should be laid out so the answer is instantly readable at a glance.`;
    const answers = await askJev(env, state, {
      ...(original ? { mode: { type: 'choice' as const, instructions: 'What kind of follow-up is this?', criteria: MODES } } : {}),
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
      time_sensitive: {
        type: 'noul',
        instructions: 'The answer changes from day to day or week to week (breaking news, live readings like weather, live scores, today\'s schedules, market prices), so filtering results by date would clearly help. Product comparisons, reviews, how-tos, history and explanations do not count.',
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
      timeSensitive: noul(answers, 'time_sensitive') >= 0.6,
      mode: original ? ((choice(answers, 'mode')?.choice as FollowupMode | undefined) ?? 'answer') : undefined,
      target: Number(choice(answers, 'target')?.choice.slice(1)) || undefined,
      ms: Date.now() - started,
    };
  } catch (err) {
    console.error('Jev plan failed', err);
    return fallback();
  }
}
