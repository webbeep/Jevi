import type { Env } from './util';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

export function jevKey(env: Env): string | undefined {
  return env.JEV_API_KEY || env.TYPESAFE_API_KEY;
}

export async function askJev(
  env: Env,
  state: string,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  const key = jevKey(env);
  if (!key) throw new Error('JEV_API_KEY not configured');
  const base = env.JEV_BASE_URL || 'https://api.typesafe.ai';
  const body = JSON.stringify({ model: env.JEV_MODEL || 'jev-1.13.0', state, questions });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) return ((await res.json()) as { answers: Record<string, JevAnswer> }).answers;
    if (res.status !== 429 && res.status !== 529) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 300 * 2 ** attempt)));
  }
  throw new Error('Jev overloaded');
}

export function noul(answers: Record<string, JevAnswer>, id: string): number {
  const a = answers[id];
  return a?.type === 'noul' ? a.noul : 0;
}

export function choice(answers: Record<string, JevAnswer>, id: string): { choice: string; probabilities: Record<string, number>; confidence: number } | undefined {
  const a = answers[id];
  return a?.type === 'choice' ? a : undefined;
}

export function score(answers: Record<string, JevAnswer>, id: string): number | undefined {
  const a = answers[id];
  return a?.type === 'score' ? a.score : undefined;
}
