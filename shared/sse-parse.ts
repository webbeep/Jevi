export type StreamErrorReason = 'cut' | 'server' | 'http' | 'network';

export class StreamError extends Error {
  retryable: boolean;
  reason: StreamErrorReason;

  constructor(message: string, reason: StreamErrorReason, retryable: boolean) {
    super(message);
    this.name = 'StreamError';
    this.reason = reason;
    this.retryable = retryable;
  }
}

export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Pulls complete SSE frames (separated by a blank line) out of `buffer`.
 * A body is `cut` when it closes without a `done` or `error` frame.
 */
export function parseSseFrames(buffer: string): { events: SseFrame[]; rest: string; cut: boolean } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: SseFrame[] = [];
  for (const frame of parts) {
    const event = frame.match(/^event: (.*)$/m)?.[1];
    const data = frame.match(/^data: (.*)$/m)?.[1];
    if (!event || !data) continue;
    events.push({ event, data });
  }
  const finished = events.some((e) => e.event === 'done' || e.event === 'error');
  return { events, rest, cut: !finished };
}

export const EMPTY_DONE_MESSAGE = "Couldn't build an answer — try asking again.";

/**
 * A `done` frame that arrived with no card nodes. An existing result stays
 * put; otherwise the person can retry the turn by hand.
 */
export function emptyDoneState(hadResult: boolean): { error: string | undefined; retryable: boolean | undefined } {
  if (hadResult) return { error: undefined, retryable: undefined };
  return { error: EMPTY_DONE_MESSAGE, retryable: true };
}

/** One silent retry, and only before any card content has been shown. */
export function shouldAutoRetry(err: unknown, attempt: number, sawContent: boolean): boolean {
  return err instanceof StreamError
    && err.retryable
    && (err.reason === 'cut' || err.reason === 'network')
    && attempt === 0
    && !sawContent;
}
