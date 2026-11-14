import asset from './cache-worker.bundle' with { type: 'file' };
import { record, number } from '../decode.ts';
export class RenderWrites {
  private worker: Worker | undefined;
  private next = 0;
  private pending = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
  private queue: {
    type: 'put' | 'touch';
    key: string;
    path: string;
    lines?: string[];
    revision: number;
  }[] = [];
  private revisions = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    readonly path: string,
    readonly budget: number,
  ) {}
  put(key: string, path: string, lines: string[]): void {
    this.queue.push({ type: 'put', key, path, lines, revision: this.revisions.get(path) ?? 0 });
    this.schedule();
  }
  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 0);
  }
  touch(key: string, path: string): void {
    this.queue.push({ type: 'touch', key, path, revision: this.revisions.get(path) ?? 0 });
    this.schedule();
  }
  invalidate(path: string): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    if (this.worker)
      void this.call({ type: 'invalidate', path }).catch((e) =>
        process.stderr.write('faah cache: ' + String(e) + '\n'),
      );
  }
  private call(value: Record<string, unknown>): Promise<void> {
    if (!this.worker) {
      this.worker = new Worker(asset);
      this.worker.onmessage = (e: MessageEvent<unknown>) => {
        const v = record(e.data),
          id = number(v.id),
          call = this.pending.get(id);
        this.pending.delete(id);
        if (typeof v.error === 'string') call?.reject(new Error(v.error));
        else call?.resolve();
      };
      this.worker.onerror = (error) => {
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
      };
      this.worker.postMessage({ type: 'init', path: this.path, budget: this.budget });
    }
    const worker = this.worker,
      id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...value, id });
    });
  }
  private flush(): void {
    const jobs = this.queue;
    this.queue = [];
    for (const job of jobs)
      if ((this.revisions.get(job.path) ?? 0) === job.revision)
        void this.call({ ...job }).catch((e) =>
          process.stderr.write('faah cache: ' + String(e) + '\n'),
        );
  }
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.flush();
    if (this.worker) {
      await this.call({ type: 'close' });
      this.worker.terminate();
      this.worker = undefined;
    }
  }
}
