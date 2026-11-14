export function sse(
  signal: AbortSignal,
  subscribe: (send: (event: string, value: unknown) => void) => () => void,
): Response {
  const encoder = new TextEncoder();
  let close = () => {
    /* start assigns cleanup before cancellation can run. */
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const write = (value: string) => {
        if (!ended) controller.enqueue(encoder.encode(value));
      };
      const unsubscribe = subscribe((event, value) =>
        write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`),
      );
      const ping = setInterval(() => write(': ping\n\n'), 15000);
      close = () => {
        if (ended) return;
        ended = true;
        clearInterval(ping);
        unsubscribe();
        controller.close();
      };
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) close();
    },
    cancel() {
      close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
