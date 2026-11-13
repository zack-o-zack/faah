import type { StreamHandler } from '../lib/events.ts';
import { createRoot, onCleanup } from 'solid-js';
import { createEventStream } from '../lib/events.ts';
import { streamPath } from './snapshot.ts';

/** Owns the workspace's one event connection: snapshots, metrics, and the threads and review topics while they are wanted. */
export function createWorkspaceStream(options: WorkspaceStreamOptions = {}): WorkspaceStream {
  const handlers = new Map<string, Set<StreamHandler>>();
  const threads = new Map<string, number>();
  const topics: Record<string, boolean> = { threads: false, review: false };
  let connection: EventSource | null = null;
  let release: (() => void) | null = null;
  let wanted = false;
  let disposed = false;
  let queued = false;
  let lastTraffic = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
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
          (data: unknown) => {
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
    subscribe(name: string, handler: StreamHandler) {
      if (!handlers.has(name)) {
        handlers.set(name, new Set());
        if (connection) reconnectSoon();
      }
      handlers.get(name)?.add(handler);
      return () => {
        handlers.get(name)?.delete(handler);
      };
    },
    topic(name: string, enabled: boolean) {
      if (topics[name] === !!enabled) return;
      topics[name] = !!enabled;
      reconnectSoon();
    },
    watch(id: string) {
      if (!id) return () => {};
      threads.set(id, (threads.get(id) || 0) + 1);
      if (threads.get(id) === 1) reconnectSoon();
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        const count = (threads.get(id) || 1) - 1;
        if (count) threads.set(id, count);
        else {
          threads.delete(id);
          reconnectSoon();
        }
      };
    },
  };
}

/** Bind a topic callback to the current feature owner without owning another connection. */
export function createWorkspaceSubscription(
  app: { actions: { subscribeWorkspaceEvent: WorkspaceStream['subscribe'] } },
  name: string,
  listener: StreamHandler,
): () => void {
  const release = app.actions.subscribeWorkspaceEvent(name, listener);
  onCleanup(release);
  return release;
}

export interface WorkspaceStreamOptions {
  connected?: (connected: boolean) => void;
  refresh?: () => void | Promise<unknown>;
  report?: (error: unknown) => void;
}
export interface WorkspaceStream {
  start: () => void;
  dispose: () => void;
  stop: () => void;
  subscribe: (name: string, handler: StreamHandler) => () => void;
  topic: (name: string, enabled: boolean) => void;
  watch: (id: string) => () => void;
}
