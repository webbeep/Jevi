import type { AnswerCard, CardNode, FollowupContext, FollowupIntent, ImageCredit, LayoutPlan } from '../shared/card';
import { parseSseFrames, StreamError } from '../shared/sse-parse';
import type { Freshness, ImageResult, SearchResponse } from '../shared/types';

export { StreamError, shouldAutoRetry } from '../shared/sse-parse';
export type { StreamErrorReason } from '../shared/sse-parse';

export type StreamBody =
  | { kind: 'search'; query: string; freshness: Freshness; context?: string }
  | { kind: 'design'; query: string; pattern: string; depth: LayoutPlan['depth']; readPages: boolean; search: SearchResponse; simple?: boolean; followup?: FollowupContext; context?: string }
  | { kind: 'followup'; question: string; original: string; search: SearchResponse; cards: { id: number; title: string; card?: AnswerCard; pattern?: string }[]; context?: string; intent?: FollowupIntent; from?: number };

export type StreamEvent =
  | { event: 'plan'; data: LayoutPlan }
  | { event: 'search'; data: SearchResponse }
  | { event: 'pages'; data: { n: number; url: string; text: string }[] }
  | { event: 'images'; data: ImageResult[] }
  | { event: 'designing'; data: { pagesRead: number; ms: number } }
  | { event: 'thinking'; data: Record<string, never> }
  | { event: 'rewrite'; data: { query: string } }
  | { event: 'intent'; data: { intent: string; queries: string[] } }
  | { event: 'base'; data: { id: number } }
  | { event: 'credit'; data: ImageCredit }
  | { event: 'layout'; data: CardNode[] }
  | { event: 'head'; data: Omit<AnswerCard, 'body'> }
  | { event: 'node'; data: { index: number; node: CardNode } }
  | { event: 'followups'; data: string[] }
  | { event: 'done'; data: { engine: 'composed' | 'reasoning' | 'extractive'; removed: number; pagesRead: number; ms: number; via?: string } }
  | { event: 'error'; data: { message: string; retryable?: boolean } };

function httpError(status: number, message: string): StreamError {
  const retryable = status === 429 || status >= 500;
  return new StreamError(message, 'http', retryable);
}

/** POSTs to the streaming endpoint and calls `onEvent` for every Server-Sent Event as it arrives. */
export async function stream(body: StreamBody, onEvent: (e: StreamEvent) => void, signal?: AbortSignal, opts?: { retry?: boolean }): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.retry) headers['x-zo-retry'] = '1';
  let res: Response;
  try {
    res = await fetch('/api/stream', { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof TypeError) throw new StreamError(err.message || 'Network error', 'network', true);
    throw err;
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    const message = err.error ?? `Request failed (${res.status})`;
    if (res.ok) throw new StreamError('The answer was cut off.', 'cut', true);
    throw httpError(res.status, message);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let cut = true;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;
      if (!parsed.cut) cut = false;
      for (const frame of parsed.events) {
        onEvent({ event: frame.event, data: JSON.parse(frame.data) } as StreamEvent);
      }
    }
  } finally {
    // Stops the download when a handler throws (e.g. an `error` event) instead of leaving the connection open.
    reader.cancel().catch(() => undefined);
  }
  // A worker that hit a platform limit just closes the stream; without this the card would spin forever.
  if (cut && !signal?.aborted) throw new StreamError('The answer was cut off.', 'cut', true);
}
