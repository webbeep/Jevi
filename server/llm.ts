import type { Env } from './util';

/**
 * Chat-completion providers, tried in order until one answers. DeepSeek is the
 * first choice; every other provider is used only when its key is set (Workers AI
 * only when the AI binding exists). LLM_ORDER (comma-separated ids) overrides the
 * order and can leave providers out.
 */
interface ProviderDef {
  id: string;
  label: string;
  keyVar: string;
  baseVar: string;
  modelVar: string;
  base: string;
  model: string;
  /** Extra request fields for this provider, e.g. how much hidden reasoning to allow. */
  extra?: (think: boolean, model: string) => Record<string, unknown>;
}

const DEFS: ProviderDef[] = [
  {
    id: 'deepseek', label: 'DeepSeek', keyVar: 'DEEPSEEK_API_KEY', baseVar: 'DEEPSEEK_BASE_URL', modelVar: 'DEEPSEEK_MODEL',
    base: 'https://api.deepseek.com', model: 'deepseek-flash',
    extra: (think) => ({ thinking: { type: think ? 'enabled' : 'disabled' } }),
  },
  {
    id: 'gemini', label: 'Gemini', keyVar: 'GEMINI_API_KEY', baseVar: 'GEMINI_BASE_URL', modelVar: 'GEMINI_MODEL',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',
    extra: (think) => ({ reasoning_effort: think ? 'medium' : 'none' }),
  },
  {
    id: 'groq', label: 'Groq', keyVar: 'GROQ_API_KEY', baseVar: 'GROQ_BASE_URL', modelVar: 'GROQ_MODEL',
    base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b',
    extra: (think, model) => (model.includes('gpt-oss') ? { reasoning_effort: think ? 'medium' : 'low' } : {}),
  },
  { id: 'openrouter', label: 'OpenRouter', keyVar: 'OPENROUTER_API_KEY', baseVar: 'OPENROUTER_BASE_URL', modelVar: 'OPENROUTER_MODEL', base: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  { id: 'mistral', label: 'Mistral', keyVar: 'MISTRAL_API_KEY', baseVar: 'MISTRAL_BASE_URL', modelVar: 'MISTRAL_MODEL', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'openai', label: 'OpenAI', keyVar: 'OPENAI_API_KEY', baseVar: 'OPENAI_BASE_URL', modelVar: 'OPENAI_MODEL', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'anthropic', label: 'Claude', keyVar: 'ANTHROPIC_API_KEY', baseVar: 'ANTHROPIC_BASE_URL', modelVar: 'ANTHROPIC_MODEL', base: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5' },
  /** Any other OpenAI-compatible endpoint. */
  { id: 'custom', label: 'Custom', keyVar: 'LLM_API_KEY', baseVar: 'LLM_BASE_URL', modelVar: 'LLM_MODEL', base: '', model: '' },
];

const WORKERS_AI = { id: 'workers-ai', label: 'Workers AI', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };

interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

type Provider =
  | { kind: 'http'; id: string; label: string; base: string; key: string; model: string; extra: ProviderDef['extra'] }
  | { kind: 'binding'; id: string; label: string; ai: WorkersAiBinding; model: string };

function providers(env: Env): Provider[] {
  const all: Provider[] = DEFS.flatMap((d): Provider[] => {
    const key = env[d.keyVar];
    const base = env[d.baseVar] || d.base;
    const model = env[d.modelVar] || d.model;
    return key && base && model ? [{ kind: 'http', id: d.id, label: d.label, base: base.replace(/\/$/, ''), key, model, extra: d.extra }] : [];
  });
  const ai = (env as Record<string, unknown>).AI as WorkersAiBinding | undefined;
  if (ai && typeof ai.run === 'function' && env.WORKERS_AI !== 'off') {
    all.push({ kind: 'binding', id: WORKERS_AI.id, label: WORKERS_AI.label, ai, model: env.WORKERS_AI_MODEL || WORKERS_AI.model });
  }
  const order = env.LLM_ORDER?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!order?.length) return all;
  return order.flatMap((id) => all.filter((p) => p.id === id));
}

export function hasLlm(env: Env): boolean {
  return providers(env).length > 0;
}

export function llmNames(env: Env): string[] {
  return providers(env).map((p) => p.label);
}

/** Providers that just failed are skipped for a while instead of making every request wait on them again. */
const downUntil = new Map<string, number>();
const isDown = (p: Provider) => (downUntil.get(p.id) ?? 0) > Date.now();
const markDown = (p: Provider, ms: number) => downUntil.set(p.id, Date.now() + ms);

class ProviderError extends Error {
  constructor(message: string, readonly cooldownMs: number) {
    super(message);
  }
}

/** Waits `firstByteMs` for the response headers, then up to `totalMs` for the whole answer. */
async function post(p: Extract<Provider, { kind: 'http' }>, body: Record<string, unknown>, firstByteMs: number, totalMs: number): Promise<Response> {
  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(new Error(`${p.label} did not answer in ${firstByteMs / 1000}s`)), firstByteMs);
  const totalTimer = setTimeout(() => controller.abort(new Error(`${p.label} timed out`)), totalMs);
  try {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json', ...(p.id === 'anthropic' ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(headerTimer);
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      // Bad keys and exhausted quotas stay out longer than a hiccup.
      const cooldown = res.status === 401 || res.status === 403 ? 600_000 : res.status === 429 ? 60_000 : res.status >= 500 ? 45_000 : 0;
      throw new ProviderError(`${p.label} HTTP ${res.status}: ${detail}`, cooldown);
    }
    return res;
  } catch (err) {
    clearTimeout(headerTimer);
    clearTimeout(totalTimer);
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(msg, localFailure(msg) ? 0 : 45_000);
  }
}

/** Errors from this request's own limits say nothing about the provider, so they must not bench it for everyone. */
const localFailure = (msg: string) => /too many subrequests/i.test(msg);

/** Workers AI calls have no built-in deadline; one stuck call must not hold the stream open. */
function deadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError(`${label} timed out`, 45_000)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function messages(system: string, user: string) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');

/** First JSON object in a reply, for models that wrap it in prose. */
function parseObject<T>(text: string): T {
  const s = stripFences(text);
  try {
    return JSON.parse(s) as T;
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1)) as T;
    throw new Error('Reply was not JSON');
  }
}

async function jsonFrom<T>(p: Provider, system: string, user: string, maxTokens: number): Promise<T> {
  switch (p.kind) {
    case 'http': {
      const deepseek = p.id === 'deepseek';
      const res = await post(p, {
        model: p.model,
        messages: messages(system, user),
        max_tokens: deepseek ? maxTokens : maxTokens + 1500,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        stream: false,
        ...p.extra?.(false, p.model),
      }, 15_000, 40_000);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return parseObject<T>(data.choices?.[0]?.message?.content ?? '');
    }
    case 'binding': {
      const out = (await deadline(p.ai.run(p.model, { messages: messages(system, user), max_tokens: maxTokens + 500, temperature: 0.4 }), 25_000, p.label)) as { response?: unknown };
      return typeof out.response === 'object' && out.response ? (out.response as T) : parseObject<T>(String(out.response ?? ''));
    }
    default: {
      const unreachable: never = p;
      return unreachable;
    }
  }
}

/** Parses an SSE body into text deltas; `onReasoning` fires on hidden-reasoning deltas. */
async function readSse(body: ReadableStream<Uint8Array>, onText: (t: string) => void, onReasoning: () => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const events = buf.split(/\r?\n\r?\n/);
    buf = events.pop() ?? '';
    for (const event of events) {
      const data = event.replace(/^data:\s*/gm, '').trim();
      if (!data || data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data) as { response?: string; choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] };
        const delta = obj.choices?.[0]?.delta;
        if (delta?.reasoning_content || delta?.reasoning) onReasoning();
        const text = delta?.content ?? obj.response;
        if (text) onText(text);
      } catch {
        // keep-alive or partial frame
      }
    }
  }
}

async function streamFrom(p: Provider, system: string, user: string, maxTokens: number, think: boolean, onText: (t: string) => void, onReasoning: () => void): Promise<void> {
  switch (p.kind) {
    case 'http': {
      const deepseek = p.id === 'deepseek';
      const res = await post(p, {
        model: p.model,
        messages: messages(system, user),
        max_tokens: think ? maxTokens + 4000 : deepseek ? maxTokens : maxTokens + 1500,
        ...(think ? {} : { temperature: 0.4 }),
        stream: true,
        ...p.extra?.(think, p.model),
      }, think ? 30_000 : 12_000, 60_000);
      if (!res.body) throw new ProviderError(`${p.label} sent no body`, 45_000);
      return readSse(res.body, onText, onReasoning);
    }
    case 'binding': {
      const out = await deadline(p.ai.run(p.model, { messages: messages(system, user), max_tokens: maxTokens + 500, temperature: 0.4, stream: true }), 15_000, p.label);
      if (out instanceof ReadableStream) return deadline(readSse(out as ReadableStream<Uint8Array>, onText, onReasoning), 60_000, p.label);
      onText(String((out as { response?: unknown }).response ?? ''));
      return;
    }
    default: {
      const unreachable: never = p;
      return unreachable;
    }
  }
}

function fail(p: Provider, err: unknown) {
  const cooldown = err instanceof ProviderError ? err.cooldownMs : localFailure(String(err)) ? 0 : 30_000;
  if (cooldown) markDown(p, cooldown);
  console.error(`LLM ${p.label} failed`, err instanceof Error ? err.message : err);
}

/** Healthy providers first; if every one is cooling down, try them all anyway rather than give up. */
function candidates(env: Env): Provider[] {
  const all = providers(env);
  if (!all.length) throw new Error('No language model configured: set DEEPSEEK_API_KEY or another provider key');
  const up = all.filter((p) => !isDown(p));
  return up.length ? up : all;
}

/** One JSON object from the first provider that answers. Returns the provider's label alongside. */
export async function llmJson<T>(env: Env, system: string, user: string, maxTokens = 1400): Promise<T> {
  let last: unknown;
  for (const p of candidates(env)) {
    try {
      return await jsonFrom<T>(p, system, user, maxTokens);
    } catch (err) {
      fail(p, err);
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Streams the completion and calls `onLine` for every complete output line as soon as it is written.
 * Falls back to the next provider only if nothing has been written yet, so a card never gets two
 * half-answers. Resolves with the label of the provider that answered.
 */
export async function llmLines(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
  onLine: (line: string) => void,
  opts: { think?: boolean; onThinking?: () => void } = {},
): Promise<string> {
  let last: unknown;
  for (const p of candidates(env)) {
    let text = '';
    let wrote = false;
    let thinking = false;
    const flush = (final: boolean) => {
      const lines = text.split('\n');
      text = final ? '' : lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        wrote = true;
        onLine(line.trim());
      }
    };
    try {
      await streamFrom(p, system, user, maxTokens, !!opts.think, (t) => {
        text += t;
        flush(false);
      }, () => {
        if (thinking) return;
        thinking = true;
        opts.onThinking?.();
      });
      flush(true);
      if (!wrote) throw new ProviderError(`${p.label} returned nothing`, 0);
      return p.label;
    } catch (err) {
      fail(p, err);
      if (wrote) throw err;
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
