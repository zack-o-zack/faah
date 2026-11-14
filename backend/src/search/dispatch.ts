import type { RGMatch } from './rg.ts';

// rg may interleave files, but each end event follows that file's matches.
// Backpressure limits retained complete files and their validation reads.
export class FileDispatch {
  private files = new Map<string, RGMatch[]>();
  private running = new Set<Promise<void>>();
  private failure: { error: unknown } | undefined;
  constructor(
    readonly options: {
      concurrency: number;
      match: (hit: RGMatch) => Promise<void>;
      complete?: (path: string) => void;
    },
  ) {}
  match(hit: RGMatch): void {
    const hits = this.files.get(hit.path) ?? [];
    hits.push(hit);
    this.files.set(hit.path, hits);
  }
  async complete(path: string): Promise<void> {
    const hits = this.files.get(path) ?? [];
    this.files.delete(path);
    while (this.running.size >= this.options.concurrency) await Promise.race(this.running);
    if (this.failure) throw this.failure.error;
    const task = this.run(path, hits).catch((error: unknown) => {
      this.failure = { error };
    });
    this.running.add(task);
    void task.then(() => this.running.delete(task));
  }
  private async run(path: string, hits: RGMatch[]): Promise<void> {
    for (const hit of hits) await this.options.match(hit);
    this.options.complete?.(path);
  }
  async finish(): Promise<void> {
    await Promise.all(this.running);
    this.files.clear();
    if (this.failure) throw this.failure.error;
  }
}
