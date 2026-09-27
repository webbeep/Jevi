export type Send = (event: string, data: unknown) => void;

/** Runs `work` while streaming its events to the client as Server-Sent Events. */
export function sseResponse(work: (send: Send) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let open = true;
  const send: Send = (event, data) => {
    if (!open) return;
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      open = false;
    });
  };
  void (async () => {
    try {
      await work(send);
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      open = false;
      await writer.close().catch(() => undefined);
    }
  })();
  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
