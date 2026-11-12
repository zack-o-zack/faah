import { createRoot, onCleanup } from 'solid-js';
import { createEventStream } from '../lib/events.js';
import { streamPath } from './snapshot.js';

/** Owns one connection, including the topics still consumed by phase C. */
export function createWorkspaceStream(options = {}) {
  const handlers = new Map();
  const threads = new Map();
  const topics = { threads: false, review: false };
  let connection;
  let release;
  let wanted = false;
  let disposed = false;
  let queued = false;
  let lastTraffic = Date.now();
  let timer;
  let listening = false;
  function close() {
    release?.();
    release = null;
    connection = null;
    options.connected?.(false);
  }
  function connect() {
    close();
    if (!wanted || disposed || document.hidden) return;
    createRoot((dispose) => {
      release = dispose;
      const dispatch = Object.fromEntries(
        [...handlers].map(([name, subscribers]) => [
          name,
          (data) => {
            for (const subscriber of subscribers) {
              try {
                subscriber(data)?.catch?.(options.report || console.error);
              } catch (error) {
                (options.report || console.error)(error);
              }
            }
          },
        ]),
      );
      dispatch.ping = () => {};
      connection = createEventStream(streamPath(topics, threads), dispatch, {
        onTraffic: () => {
          lastTraffic = Date.now();
        },
        onOpen: () => {
          lastTraffic = Date.now();
          options.connected?.(true);
        },
        onDisconnect: () => options.connected?.(false),
        onError: options.report,
      });
    });
  }
  function reconnectSoon() {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (wanted && !disposed) connect();
    });
  }
  function wake() {
    if (!wanted || document.hidden) return;
    if (!connection || Date.now() - lastTraffic > 5000) connect();
    options.refresh?.()?.catch?.(options.report || console.error);
  }
  function visibility() {
    if (document.hidden) close();
    else wake();
  }
  function start() {
    if (disposed) return;
    wanted = true;
    if (!listening) {
      listening = true;
      window.addEventListener('focus', wake);
      document.addEventListener('visibilitychange', visibility);
      let previousTick = Date.now();
      timer = setInterval(() => {
        const now = Date.now();
        const slept = now - previousTick > 3000;
        previousTick = now;
        if (wanted && !document.hidden && (slept || now - lastTraffic > 12000)) wake();
      }, 1000);
    }
    if (!connection) connect();
  }
  function dispose() {
    disposed = true;
    wanted = false;
    close();
    clearInterval(timer);
    if (listening) {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', visibility);
    }
    handlers.clear();
    threads.clear();
  }
  onCleanup(dispose);
  return {
    start,
    dispose,
    stop() {
      wanted = false;
      close();
    },
    subscribe(name, handler) {
      if (!handlers.has(name)) {
        handlers.set(name, new Set());
        if (connection) reconnectSoon();
      }
      handlers.get(name).add(handler);
      return () => handlers.get(name)?.delete(handler);
    },
    topic(name, enabled) {
      if (topics[name] === !!enabled) return;
      topics[name] = !!enabled;
      reconnectSoon();
    },
    watch(id) {
      if (!id) return () => {};
      threads.set(id, (threads.get(id) || 0) + 1);
      if (threads.get(id) === 1) reconnectSoon();
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        const count = threads.get(id) - 1;
        if (count) threads.set(id, count);
        else {
          threads.delete(id);
          reconnectSoon();
        }
      };
    },
  };
}
