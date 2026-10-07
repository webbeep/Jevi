import { hasLlm, llmJson } from './llm';
import type { Env } from './util';

export interface Suggestion {
  text: string;
  icon: string;
}

const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/** Starter prompts that show what ZO is for: getting things done, not just finding links. */
export async function generateSuggestions(env: Env, now = new Date()): Promise<Suggestion[]> {
  if (!hasLlm(env)) return [];
  const today = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const out = await llmJson<{ suggestions?: { text?: unknown; icon?: unknown }[] }>(
    env,
    `You write the starter prompts on the home screen of ZO, an assistant that searches the web, thinks, and answers with interactive cards (live numbers, comparisons, step-by-step plans, sliders to tweak the answer). The prompts should make someone want to tap one and show the range of what it does.

Rules:
- 8 prompts, each under 42 characters, written the way a person would actually type them.
- Mix these intents, one or two each: plan something, compare or choose, decide whether to, learn how something works, make or cook something, a live or seasonal need (fitting today's date and season, northern hemisphere).
- Concrete and specific (a real place, product type, budget, timeframe), never vague like "tell me about history".
- No news events you are unsure about, no dates later than today, no brand-new product names.
- icon: a lucide icon name in kebab-case that fits the prompt.

Reply as JSON: {"suggestions":[{"text":string,"icon":string}]}`,
    `Today is ${today}; the season is ${SEASONS[now.getUTCMonth()]}.`,
    500,
  );
  return (out.suggestions ?? [])
    .map((s) => ({ text: typeof s.text === 'string' ? s.text.trim() : '', icon: typeof s.icon === 'string' ? s.icon.trim().toLowerCase() : 'sparkles' }))
    .filter((s) => s.text && s.text.length <= 60)
    .slice(0, 8);
}
