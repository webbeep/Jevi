import type { HealthResponse } from '../../shared/types';
import { hasDeepSeek } from '../../server/deepseek';
import { jevKey } from '../../server/jev';
import { keyedEngines } from '../../server/search';
import { Env, json } from '../../server/util';

export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json({ jev: !!jevKey(env), deepseek: hasDeepSeek(env), keyedEngines: keyedEngines(env) } satisfies HealthResponse);
