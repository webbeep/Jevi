import type { HealthResponse } from '../../shared/types';
import { jevKey } from '../../server/jev';
import { llmNames } from '../../server/llm';
import { keyedEngines } from '../../server/search';
import { Env, json } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json({ jev: !!jevKey(env), llm: llmNames(env), keyedEngines: keyedEngines(env) } satisfies HealthResponse);
