import { normalizeCRLF } from './text.ts';
import { stat } from 'node:fs/promises';
import { Document } from './document.ts';
import { RenderPool } from './pool.ts';
import { RenderDisk } from './disk.ts';
import { LRU } from './lru.ts';
export class RenderService {
  readonly cache = new LRU<Document>();
  readonly pool = new RenderPool();
  readonly disk: RenderDisk;
  private opening = new Map<string, Promise<Document>>();
  private rendering = new Map<string, Promise<string[]>>();
  private revisions = new Map<string, number>();
  private closed = false;
  private backgrounds = new Set<Promise<void>>();
  constructor(disk?: RenderDisk) {
    this.disk = disk ?? new RenderDisk();
  }
  async highlight(source: string, lang: string, want: number, path = ''): Promise<string[]> {
    const key = this.disk.key(source, lang, want),
      revision = this.revisions.get(path) ?? 0;
    const cached = this.disk.get(key, path);
    if (cached) return cached;
    let task = this.rendering.get(key);
    if (!task) {
      task = this.pool.render(source, lang, want).finally(() => this.rendering.delete(key));
      this.rendering.set(key, task);
    }
    const lines = await task;
    if (!this.closed && (this.revisions.get(path) ?? 0) === revision)
      this.disk.put(key, path, lines);
    return lines;
  }
  async open(abs: string, rel: string): Promise<Document> {
    const info = await stat(abs, { bigint: true });
    if (info.isDirectory()) throw new Error('is a directory');
    if (info.size > 64n * 1024n * 1024n) throw new Error(`file too large (${info.size} bytes)`);
    const key = `${abs}|${info.mtimeNs}|${info.size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let task = this.opening.get(key);
    if (!task) {
      const revision = this.revisions.get(abs) ?? 0;
      task = (async () => {
        const data = await Bun.file(abs).bytes();
        if (data.subarray(0, 8000).includes(0)) throw new Error('binary file');
        const doc = new Document(
          normalizeCRLF(data),
          rel,
          (source, lang, want) => this.highlight(source, lang, want, abs),
          (delta) => this.cache.grow(key, delta),
          (task) => {
            this.backgrounds.add(task);
            void task.finally(() => this.backgrounds.delete(task)).catch(() => undefined);
          },
        );
        if (!this.closed && (this.revisions.get(abs) ?? 0) === revision)
          this.cache.put(key, doc, doc.initialBytes);
        return doc;
      })().finally(() => this.opening.delete(key));
      this.opening.set(key, task);
    }
    return task;
  }
  invalidate(abs: string): void {
    this.revisions.set(abs, (this.revisions.get(abs) ?? 0) + 1);
    this.cache.remove(abs);
    this.disk.invalidate(abs);
  }
  scavenge(): void {
    this.cache.trim();
    this.pool.scavenge();
    Bun.gc(true);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.opening.values());
    await Promise.allSettled(this.backgrounds);
    await Promise.allSettled(this.rendering.values());
    this.pool.close();
    this.cache.clear();
    this.disk.close();
  }
}
