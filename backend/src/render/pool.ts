import workerAsset from './worker.bundle' with { type: 'file' };
import { availableParallelism } from 'node:os';
import { record, number, string } from '../decode.ts';
class Shard {
  readonly worker = new Worker(workerAsset);
  readonly pending = new Map<
    number,
    { resolve: (lines: string[]) => void; reject: (error: unknown) => void }
  >();
  private next = 0;
  constructor() {
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const v = record(event.data),
          id = number(v.id),
          call = this.pending.get(id);
        this.pending.delete(id);
        if (typeof v.error === 'string') {
          call?.reject(new Error(v.error));
          return;
        }
        if (!Array.isArray(v.lines)) throw new Error('invalid rendered lines');
        call?.resolve(v.lines.map((line) => string(line)));
      } catch (error) {
        this.fail(error);
      }
    };
    this.worker.onerror = (error) => this.fail(error);
  }
  private fail(error: unknown): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  render(source: string, lang: string, want: number): Promise<string[]> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, source, lang, want });
    });
  }
  close(): void {
    this.fail(new Error('render pool closed'));
    this.worker.terminate();
  }
}
export class RenderPool {
  private shards: Shard[] = [];
  render(source: string, lang: string, want: number): Promise<string[]> {
    let shard = this.shards.reduce<Shard | undefined>(
      (best, s) => (!best || s.pending.size < best.pending.size ? s : best),
      undefined,
    );
    if (
      !shard ||
      (shard.pending.size && this.shards.length < Math.min(4, availableParallelism()))
    ) {
      shard = new Shard();
      this.shards.push(shard);
    }
    return shard.render(source, lang, want);
  }
  scavenge(): void {
    for (const s of this.shards) s.worker.postMessage({ type: 'gc' });
  }
  close(): void {
    for (const s of this.shards) s.close();
    this.shards = [];
  }
}
