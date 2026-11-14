import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { trimSpace } from '../text.ts';
import { GitProcesses } from './process.ts';

export interface GitInfo {
  top: string;
  dir: string;
}
export class GitProbe {
  private readonly cache = new Map<string, GitInfo>();
  private readonly pending = new Map<string, Promise<GitInfo | undefined>>();
  constructor(
    readonly processes: GitProcesses,
    readonly enabled = true,
  ) {}
  async get(root: string): Promise<GitInfo | undefined> {
    if (!this.enabled) return;
    const cached = this.cache.get(root);
    if (cached) {
      if (await lstat(cached.dir).catch(() => undefined)) return cached;
      this.cache.delete(root);
    }
    let task = this.pending.get(root);
    if (!task) {
      task = this.detect(root).finally(() => this.pending.delete(root));
      this.pending.set(root, task);
    }
    return task;
  }
  private async detect(root: string): Promise<GitInfo | undefined> {
    try {
      let result = await this.processes.run(root, ['rev-parse', '--show-toplevel']);
      let prefix: string[] = [];
      if (result.code !== 0) {
        prefix = ['-c', 'safe.directory=*'];
        result = await this.processes.run(root, ['rev-parse', '--show-toplevel'], {
          globalArgs: prefix,
        });
      }
      if (result.code !== 0) return;
      const top = trimSpace(result.stdout);
      const dirResult = await this.processes.run(root, ['rev-parse', '--git-dir'], {
        globalArgs: prefix,
      });
      const raw = trimSpace(dirResult.stdout);
      const info = {
        top,
        dir: dirResult.code === 0 ? (isAbsolute(raw) ? raw : join(top, raw)) : join(top, '.git'),
      };
      this.cache.set(root, info);
      return info;
    } catch {
      // Missing git, inaccessible repositories and failed probes stay retryable.
      return;
    }
  }
}
export function repoKey(info: GitInfo, root: string): (path: string) => string | undefined {
  const rel = relative(info.top, root).split(sep).join('/');
  const prefix = rel && rel !== '.' ? rel + '/' : '';
  return (path) =>
    !prefix ? path : path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}
