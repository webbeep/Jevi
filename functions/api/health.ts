import type { HealthResponse } from '../../shared/types';
import { jevKey } from '../../server/jev';
import { llmNames } from '../../server/llm';
import { usageToday } from '../../server/providerCap';
import { keyedEngines } from '../../server/search';
import { Env, json } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json({
    jev: !!jevKey(env),
    llm: llmNames(env),
    keyedEngines: keyedEngines(env),
    // Today's (UTC) provider calls vs daily cap, counts only. QA stops evals at 30% of the eval cap.
    providerUsage: { day: new Date().toISOString().slice(0, 10), providers: (await usageToday(env)) ?? null },
  } satisfies HealthResponse, 200, { 'cache-control': 'no-store' });
