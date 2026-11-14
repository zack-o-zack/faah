import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PathError, resolveFile, fileError } from './service.ts';
import type { RenderService } from '../render/service.ts';
import type { LegacyFiles } from '../legacy/files.ts';
export class FileMutations {
  constructor(
    readonly options: {
      root: string;
      render: RenderService;
      legacy: LegacyFiles;
      touch: (path: string) => Promise<void>;
    },
  ) {}
  private target(path: string): { abs: string; rel: string } {
    const file = resolveFile(this.options.root, path);
    if (!file.rel) throw new PathError(400, 'bad path');
    return file;
  }
  private async directories(path: string, prefix: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true, mode: 0o755 });
    } catch (error) {
      throw new PathError(500, prefix + fileError(error, path));
    }
  }
  async changed(abs: string, rel: string): Promise<void> {
    this.options.render.invalidate(abs);
    await Promise.all([this.options.touch(rel), this.options.legacy.changed(rel)]);
  }
  async save(path: string, content: string) {
    const { abs, rel } = this.target(path);
    await this.directories(dirname(abs), 'failed to create directory: ');
    if ((await stat(abs).catch(() => undefined))?.isDirectory())
      throw new PathError(400, 'target is a directory');
    try {
      await writeFile(abs, content, { mode: 0o644 });
    } catch (error) {
      throw new PathError(500, 'failed to write file: ' + fileError(error, abs));
    }
    await this.changed(abs, rel);
    return { ok: true, path: rel, size: Buffer.byteLength(content) };
  }
  async create(path: string, type: string) {
    const { abs, rel } = this.target(path);
    if (await stat(abs).catch(() => undefined)) throw new PathError(409, 'already exists: ' + rel);
    if (type === 'dir') await this.directories(abs, 'failed to create directory: ');
    else {
      await this.directories(dirname(abs), 'failed to create parent directory: ');
      try {
        await writeFile(abs, '', { mode: 0o644 });
      } catch (error) {
        throw new PathError(500, 'failed to create file: ' + fileError(error, abs));
      }
    }
    await this.changed(abs, rel);
    return { ok: true, path: rel, type };
  }
  async close(path: string, resolve: (path: string) => Promise<{ abs: string; rel: string }>) {
    const { abs, rel } = await resolve(path);
    await this.changed(abs, rel);
    return { ok: true, path: rel };
  }
}
