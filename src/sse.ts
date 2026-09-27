import type { AnswerCard, CardNode, FollowupContext, LayoutPlan } from '../shared/card';
import type { Freshness, ImageResult, SearchResponse } from '../shared/types';

export type StreamBody =
  | { kind: 'search'; query: string; freshness: Freshness; context?: string }
  | { kind: 'design'; query: string; pattern: string; depth: LayoutPlan['depth']; readPages: boolean; search: SearchResponse; simple?: boolean; followup?: FollowupContext; context?: string };

export type StreamEvent =
  | { event: 'plan'; data: LayoutPlan }
  | { event: 'search'; data: SearchResponse }
  | { event: 'pages'; data: { n: number; url: string; text: string }[] }
  | { event: 'images'; data: ImageResult[] }
  | { event: 'designing'; data: { pagesRead: number; ms: number } }
  | { event: 'layout'; data: CardNode[] }
  | { event: 'head'; data: Omit<AnswerCard, 'body'> }
  | { event: 'node'; data: { index: number; node: CardNode } }
  | { event: 'followups'; data: string[] }
  | { event: 'done'; data: { engine: 'deepseek' | 'extractive'; removed: number; pagesRead: number; ms: number } }
  | { event: 'error'; data: { message: string } };

/** POSTs to the streaming endpoint and calls `onEvent` for every Server-Sent Event as it arrives. */
export async function stream(body: StreamBody, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = frame.match(/^event: (.*)$/m)?.[1];
      const data = frame.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent({ event, data: JSON.parse(data) } as StreamEvent);
    }
  }
}
