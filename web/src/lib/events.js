import { batch, onCleanup } from 'solid-js';

// EventSource retries interrupted connections; closing the owner stops retries too.
export function createEventStream(url, handlers, options = {}) {
  const stream = new EventSource(new URL(url.replace(/^\//, ''), document.baseURI));
  if (options.onOpen) stream.addEventListener('open', options.onOpen);
  if (options.onDisconnect) stream.addEventListener('error', options.onDisconnect);
  for (const [name, handler] of Object.entries(handlers)) {
    stream.addEventListener(name, (event) => {
      options.onTraffic?.();
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const report = options.onError || console.error;
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
export function createPolling(action, delay, visible = true) {
  let disposed = false;
  let timer;
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
