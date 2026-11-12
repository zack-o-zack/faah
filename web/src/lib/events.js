import { onCleanup } from 'solid-js';

// EventSource retries interrupted connections; closing the owner stops retries too.
export function createEventStream(url, handlers, options = {}) {
  const stream = new EventSource(new URL(url.replace(/^\//, ''), document.baseURI));
  for (const [name, handler] of Object.entries(handlers)) {
    stream.addEventListener(name, event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      Promise.resolve().then(() => handler(data)).catch(options.onError || console.error);
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
    try { if (!visible || !document.hidden) await action(); }
    finally { if (!disposed) timer = setTimeout(tick, delay); }
  }
  void tick();
  onCleanup(() => { disposed = true; clearTimeout(timer); });
}
