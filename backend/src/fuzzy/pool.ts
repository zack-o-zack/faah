import workerAsset from './worker.bundle' with { type: 'file' };
import { availableParallelism } from 'node:os';
import { record, number } from '../decode.ts';
import { results } from './protocol.ts';
import { find, rank, type Item, type Result } from './score.ts';
class Shard {
  readonly worker = new Worker(workerAsset);
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (r: Result[]) => void; reject: (e: unknown) => void }
  >();
  constructor() {
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const v = record(event.data),
          id = number(v.id);
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.resolve(results(v.results));
      } catch (error) {
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
      }
    };
    this.worker.onerror = (error) => {
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
  }
  call(value: Record<string, unknown>): Promise<Result[]> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...value, id });
    });
  }
  close(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('fuzzy pool closed'));
    this.pending.clear();
  }
}
export class FuzzyPool {
  private shards: Shard[] = [];
  private items: Item[] = [];
  private updated: Promise<unknown> = Promise.resolve();
  get workerCount(): number {
    return this.shards.length;
  }
  set(items: Item[]): Promise<unknown> {
    this.updated = this.updated.catch(() => undefined).then(() => this.install(items));
    return this.updated;
  }
  private async install(items: Item[]): Promise<void> {
    this.items = items;
    if (items.length < 4000) {
      for (const shard of this.shards) shard.close();
      this.shards = [];
      return;
    }
    if (!this.shards.length)
      this.shards = Array.from({ length: Math.min(4, availableParallelism()) }, () => new Shard());
    const size = Math.ceil(items.length / this.shards.length);
    await Promise.all(
      this.shards.map((shard, i) =>
        shard.call({
          type: 'set',
          paths: items.slice(i * size, (i + 1) * size).map((it) => it.path),
        }),
      ),
    );
  }
  async find(query: string, limit: number): Promise<Result[]> {
    await this.updated;
    if (!this.shards.length || !query.trim().replace(/ /g, ''))
      return find(this.items, query, limit);
    const parts = await Promise.all(this.shards.map((s) => s.call({ type: 'find', query, limit })));
    return parts
      .flat()
      .sort(rank)
      .slice(0, limit > 0 ? limit : undefined);
  }
  close(): void {
    for (const shard of this.shards) shard.close();
    this.shards = [];
  }
}
