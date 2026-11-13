import { batch, onCleanup } from 'solid-js';

// EventSource retries interrupted connections; closing the owner stops retries too.
export interface StreamOptions {
  onOpen?: (event: Event) => void;
  onDisconnect?: (event: Event) => void;
  onTraffic?: () => void;
  onError?: (error: unknown) => void;
}
export type StreamHandler = (data: unknown) => void | Promise<unknown>;
export function createEventStream(
  url: string,
  handlers: Record<string, StreamHandler>,
  options: StreamOptions = {},
): EventSource {
  const stream = new EventSource(new URL(url.replace(/^\//, ''), document.baseURI));
  if (options.onOpen) stream.addEventListener('open', options.onOpen);
  if (options.onDisconnect) stream.addEventListener('error', options.onDisconnect);
  for (const [name, handler] of Object.entries(handlers)) {
    stream.addEventListener(name, (event) => {
      if (!('data' in event) || typeof event.data !== 'string') return;
      options.onTraffic?.();
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const report: (error: unknown) => void = options.onError || console.error;
      try {
        const result = batch(() => handler(data));
        result?.catch?.(report);
      } catch (error) {
        report(error);
      }
    });
  }
  onCleanup(() => stream.close());
  return stream;
}
export function createPolling(
  action: () => void | Promise<unknown>,
  delay: number,
  visible = true,
): void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    if (disposed) return;
    try {
      if (!visible || !document.hidden) await action();
    } finally {
      if (!disposed) timer = setTimeout(tick, delay);
    }
  }
  void tick();
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });
}
