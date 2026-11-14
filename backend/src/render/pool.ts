import workerAsset from './worker.bundle' with { type: 'file' };
import { availableParallelism } from 'node:os';
import { record, number, string } from '../decode.ts';
import { grammarAssets, grammarGroups } from './grammar-assets.js';
import { RenderCancelled } from './cancel.ts';
class Shard {
  warming = false;
  readonly worker = new Worker(workerAsset);
  readonly pending = new Map<
    number,
    { resolve: (lines: string[]) => void; reject: (error: unknown) => void; warm: boolean }
  >();
  private next = 0;
  private closed = false;
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
    this.worker.postMessage({ type: 'init', assets: grammarAssets, groups: grammarGroups });
  }
  private fail(error: unknown): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  render(source: string, lang: string, want: number): Promise<string[]> {
    return this.call({ source, lang, want });
  }
  warm(langs: readonly string[]): Promise<string[]> {
    this.warming = true;
    return this.call({ type: 'warm', langs }).finally(() => {
      this.warming = false;
    });
  }
  private call(value: Record<string, unknown>): Promise<string[]> {
    if (this.closed) return Promise.reject(new RenderCancelled());
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, warm: value.type === 'warm' });
      this.worker.postMessage({ ...value, id });
    });
  }
  cancelWarm(): void {
    if (this.closed) return;
    for (const [id, call] of this.pending)
      if (call.warm) {
        this.pending.delete(id);
        call.reject(new RenderCancelled());
      }
    this.warming = false;
    this.worker.postMessage({ type: 'cancel-warm' });
  }
  close(): void {
    this.closed = true;
    this.fail(new RenderCancelled());
    this.worker.terminate();
  }
}
export class RenderPool {
  private shards: Shard[] = [];
  private closed = false;
  render(source: string, lang: string, want: number): Promise<string[]> {
    if (this.closed) return Promise.reject(new RenderCancelled());
    let shard = this.shards.reduce<Shard | undefined>(
      (best, s) => (!best || s.pending.size < best.pending.size ? s : best),
      undefined,
    );
    if (
      !shard ||
      (shard.pending.size &&
        !shard.warming &&
        this.shards.length < Math.min(4, availableParallelism()))
    ) {
      shard = new Shard();
      this.shards.push(shard);
    }
    return shard.render(source, lang, want);
  }
  prepare(): void {
    if (this.closed) throw new RenderCancelled();
    if (!this.shards.length) this.shards.push(new Shard());
  }
  async warm(langs: readonly string[]): Promise<void> {
    this.prepare();
    await Promise.all(this.shards.map((shard) => shard.warm(langs)));
  }
  scavenge(): void {
    for (const s of this.shards) s.worker.postMessage({ type: 'gc' });
  }
  cancelWarm(): void {
    for (const shard of this.shards) shard.cancelWarm();
  }
  close(): void {
    this.closed = true;
    for (const s of this.shards) s.close();
    this.shards = [];
  }
}
