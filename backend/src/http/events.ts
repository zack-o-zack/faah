export interface EventSink {
  send: (frame: string) => boolean;
  close: () => void;
}
export function eventFrame(event: string, data: unknown): string {
  return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}
// The fan-in queue matches Go's 64-frame buffer. A stalled client must reconnect
// for fresh snapshots rather than accumulate an unbounded response body.
export function eventResponse(
  signal: AbortSignal,
  connect: (sink: EventSink) => Promise<() => void>,
): Response {
  const encoder = new TextEncoder();
  const queued: Uint8Array[] = [];
  let ended = false,
    cleanup: (() => void) | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', close);
    if (ping) clearInterval(ping);
    cleanup?.();
    queued.length = 0;
    try {
      controller?.close();
    } catch {
      /* cancel() already closed the body. */
    }
  };
  const send = (frame: string): boolean => {
    if (ended) return false;
    const bytes = encoder.encode(frame);
    if (controller && (controller.desiredSize ?? 0) > 0) controller.enqueue(bytes);
    else if (queued.length < 64) queued.push(bytes);
    else {
      close();
      return false;
    }
    return true;
  };
  const body = new ReadableStream<Uint8Array>({
    start(target) {
      controller = target;
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) {
        close();
        return;
      }
      ping = setInterval(() => {
        send(': ping\n\n');
        send(eventFrame('ping', {}));
      }, 15000);
      void connect({ send, close })
        .then((stop) => {
          if (ended) stop();
          else cleanup = stop;
        })
        .catch(close);
    },
    pull(target) {
      const next = queued.shift();
      if (next) target.enqueue(next);
    },
    cancel: close,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
