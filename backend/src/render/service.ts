import { normalizeCRLF } from './text.ts';
import { stat } from 'node:fs/promises';
import { Document, sizeOfLines } from './document.ts';
import { RenderPool } from './pool.ts';
import { RenderDisk } from './disk.ts';
import { LRU } from './lru.ts';
import { RenderWrites } from './writes.ts';
import { filenameLanguage } from './language.ts';
import { RenderCancelled } from './cancel.ts';
export class RenderService {
  readonly cache = new LRU<Document>();
  readonly pool = new RenderPool();
  readonly disk: RenderDisk;
  private readonly writes: RenderWrites;
  private readonly memo = new LRU<string[]>(1 << 20);
  private opening = new Map<string, Promise<Document>>();
  private rendering = new Map<string, Promise<string[]>>();
  private revisions = new Map<string, number>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private backgrounds = new Set<Promise<void>>();
  constructor(disk?: RenderDisk) {
    this.disk = disk ?? new RenderDisk();
    this.writes = new RenderWrites(this.disk.path, this.disk.budget);
  }
  async highlight(source: string, lang: string, want: number, path = ''): Promise<string[]> {
    if (this.closed) throw new RenderCancelled();
    const key = this.disk.key(source, lang, want),
      revision = this.revisions.get(path) ?? 0;
    const memo = this.memo.get(key);
    if (memo) return memo;
    const cached = this.disk.get(key, path, false);
    if (cached) {
      this.writes.touch(key, path);
      this.remember(key, cached);
      return cached;
    }
    let task = this.rendering.get(key);
    if (!task) {
      task = this.pool.render(source, lang, want).finally(() => this.rendering.delete(key));
      this.rendering.set(key, task);
    }
    let lines: string[];
    try {
      lines = await task;
    } catch (error) {
      if (this.closed) throw new RenderCancelled();
      throw error;
    }
    if (this.closed) throw new RenderCancelled();
    if (!this.closed && (this.revisions.get(path) ?? 0) === revision)
      this.writes.put(key, path, lines);
    this.remember(key, lines);
    return lines;
  }
  private remember(key: string, lines: string[]): void {
    const size = sizeOfLines(lines);
    if (size <= this.memo.budget) this.memo.put(key, lines, size);
  }
  warm(paths: readonly string[]): Promise<void> {
    if (this.closed) return Promise.resolve();
    const task = this.warmLanguages(paths).catch((error: unknown) => {
      if (!this.closed && !(error instanceof RenderCancelled)) throw error;
    });
    this.observe(task);
    return task;
  }
  private observe(task: Promise<void>): void {
    this.backgrounds.add(task);
    void task.finally(() => this.backgrounds.delete(task)).catch(() => undefined);
  }
  private async warmLanguages(paths: readonly string[]): Promise<void> {
    const counts = new Map<string, number>(),
      names = new Map<string, string | undefined>();
    for (const path of paths) {
      const suffix = /\.[^/.]+$/.exec(path)?.[0] ?? path.split('/').at(-1) ?? path;
      if (!names.has(suffix)) names.set(suffix, filenameLanguage(path));
      const lang = names.get(suffix);
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    await this.pool.warm(
      [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([lang]) => lang),
    );
  }
  async open(abs: string, rel: string): Promise<Document> {
    if (this.closed) throw new RenderCancelled();
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
          (task) => this.observe(task),
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
    if (this.closed) return;
    this.revisions.set(abs, (this.revisions.get(abs) ?? 0) + 1);
    this.cache.remove(abs);
    this.disk.invalidate(abs);
    this.writes.invalidate(abs);
  }
  scavenge(): void {
    this.cache.trim();
    this.memo.clear();
    this.pool.scavenge();
    Bun.gc(true);
  }
  close(): Promise<void> {
    return (this.closing ??= this.finish());
  }
  private async finish(): Promise<void> {
    this.closed = true;
    this.pool.cancelWarm();
    await Promise.allSettled(this.opening.values());
    await Promise.allSettled(this.backgrounds);
    await Promise.allSettled(this.rendering.values());
    this.pool.close();
    await this.writes.close();
    this.cache.clear();
    this.disk.close();
  }
}
