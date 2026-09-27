import type { Env } from './util';

export function hasDeepSeek(env: Env): boolean {
  return !!env.DEEPSEEK_API_KEY;
}

function request(env: Env, system: string, user: string, maxTokens: number, extra: Record<string, unknown>): Promise<Response> {
  if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not configured');
  return fetch(`${env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
      max_tokens: maxTokens,
      temperature: 0.4,
      ...extra,
    }),
    signal: AbortSignal.timeout(45000),
  });
}

export async function deepseekJson<T>(env: Env, system: string, user: string, maxTokens = 1400): Promise<T> {
  const res = await request(env, system, user, maxTokens, { response_format: { type: 'json_object' }, stream: false });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message.content ?? '{}';
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
}

/** Streams the completion and calls `onLine` for every complete output line, as soon as it is written. */
export async function deepseekLines(env: Env, system: string, user: string, maxTokens: number, onLine: (line: string) => void): Promise<void> {
  const res = await request(env, system, user, maxTokens, { stream: true });
  if (!res.ok || !res.body) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let sse = '';
  let text = '';
  const flushLines = (final: boolean) => {
    const lines = text.split('\n');
    text = final ? '' : lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line.trim());
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    sse += value;
    const events = sse.split('\n\n');
    sse = events.pop() ?? '';
    for (const event of events) {
      const data = event.replace(/^data:\s*/gm, '').trim();
      if (!data || data === '[DONE]') continue;
      try {
        text += (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? '';
      } catch {
        // keep-alive or partial frame
      }
    }
    flushLines(false);
  }
  flushLines(true);
}
