import type { GitWorkspace } from '../git/workspace.ts';
import { LegacyFeeds } from '../legacy/feeds.ts';
import { eventResponse, eventFrame } from './events.ts';
export class WorkspaceStreams {
  private readonly clients = new Set<() => void>();
  private readonly opening = new Set<Promise<unknown>>();
  private closed = false;
  readonly feeds: LegacyFeeds;
  constructor(
    readonly git: GitWorkspace,
    origin: string,
    base: string,
    readonly metrics: () => Promise<unknown>,
  ) {
    this.feeds = new LegacyFeeds(origin, base);
  }
  response(signal: AbortSignal, query: URLSearchParams, metrics: boolean): Response {
    return eventResponse(signal, (sink) => {
      const task = (async () => {
        if (this.closed) {
          sink.close();
          return () => {};
        }
        this.clients.add(sink.close);
        const cleanups: (() => void)[] = [() => this.clients.delete(sink.close)];
        const stop = () => {
          for (const cleanup of cleanups.splice(0)) cleanup();
        };
        try {
          if (metrics && !sink.send(eventFrame('metrics', await this.metrics()))) return stop;
          if (signal.aborted || this.closed) return stop;
          cleanups.push(
            await this.git.subscribe((value) => sink.send(eventFrame('git-status', value))),
          );
          if (signal.aborted || this.closed) return stop;
          cleanups.push(this.feeds.subscribe(query, sink));
          let collecting = false;
          if (metrics) {
            const timer = setInterval(() => {
              if (collecting) return;
              collecting = true;
              void this.metrics()
                .then((value) => sink.send(eventFrame('metrics', value)))
                .catch(sink.close)
                .finally(() => {
                  collecting = false;
                });
            }, 2500);
            cleanups.push(() => clearInterval(timer));
          }
          return stop;
        } catch (error) {
          stop();
          throw error;
        }
      })();
      this.opening.add(task);
      void task.finally(() => this.opening.delete(task)).catch(() => undefined);
      return task;
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const close of this.clients) close();
    await Promise.allSettled(this.opening);
    await this.feeds.close();
  }
}
