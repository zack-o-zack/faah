import { readdir, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { IgnoreSet, readGitignore } from '../ignore/service.ts';
import { newItem, type Item } from '../fuzzy/score.ts';
import { compare, lower } from '../text.ts';
import type { Node } from './types.ts';
export const vcs = new Set(['.git', '.hg', '.svn']);
export async function walkable(root: string, path: string): Promise<boolean> {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const info = await lstat(join(root, ...parts.slice(0, i))).catch(() => undefined);
    if (!info || info.isSymbolicLink()) return false;
  }
  return true;
}
export function sortNodes(kids: Node[]): Node[] {
  return kids.sort(
    (a, b) => Number(b.dir) - Number(a.dir) || compare(lower(a.name), lower(b.name)),
  );
}
interface Job {
  rel: string;
  ignore: IgnoreSet;
}
export interface WalkProfile {
  wallMs: number;
  bodyMs: number;
  awaitMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
}
export async function walk(options: {
  root: string;
  publish: (nodes: Node[]) => void;
  profile?: (profile: WalkProfile) => void;
}): Promise<{ files: Item[]; children: Map<string, Node[]> }> {
  const started = options.profile ? performance.now() : 0;
  const cpu = options.profile ? process.cpuUsage() : undefined;
  let bodyMs = 0;
  const children = new Map<string, Node[]>(),
    files: Item[] = [];
  const queue: Job[] = [{ rel: '', ignore: new IgnoreSet() }];
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    const drain = () => {
      while (queue.length && active < availableParallelism() * 4) {
        const job = queue.shift();
        if (!job) break;
        active++;
        void scan(job).then(() => {
          active--;
          if (!queue.length && !active) resolve();
          else drain();
        }, reject);
      }
    };
    const scan = async (job: Job) => {
      const abs = join(options.root, job.rel);
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      let resumed = options.profile ? performance.now() : 0;
      entries.sort((a, b) => compare(a.name, b.name));
      if (options.profile) bodyMs += performance.now() - resumed;
      const patterns = await readGitignore(abs, job.rel);
      resumed = options.profile ? performance.now() : 0;
      const ignore = job.ignore.child(patterns);
      const kids: Node[] = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const rel = job.rel ? job.rel + '/' + entry.name : entry.name;
        const dir = entry.isDirectory();
        if (ignore.match(rel, dir)) {
          if (!(dir && vcs.has(entry.name)))
            kids.push({ name: entry.name, path: rel, dir, size: 0, ignored: true });
          continue;
        }
        if (dir) {
          kids.push({ name: entry.name, path: rel, dir: true, size: 0 });
          queue.push({ rel, ignore });
          continue;
        }
        try {
          if (options.profile) bodyMs += performance.now() - resumed;
          const info = await stat(join(options.root, rel));
          resumed = options.profile ? performance.now() : 0;
          kids.push({ name: entry.name, path: rel, dir: false, size: info.size });
          files.push(newItem(rel, info.size, true));
        } catch {
          resumed = options.profile ? performance.now() : 0;
          continue;
        }
      }
      children.set(job.rel, sortNodes(kids));
      if (job.rel === '') options.publish(kids);
      if (options.profile) bodyMs += performance.now() - resumed;
    };
    drain();
  });
  const sorting = options.profile ? performance.now() : 0;
  files.sort((a, b) => compare(a.path, b.path));
  if (options.profile && cpu) {
    bodyMs += performance.now() - sorting;
    const wallMs = performance.now() - started,
      used = process.cpuUsage(cpu);
    options.profile({
      wallMs,
      bodyMs,
      awaitMs: Math.max(0, wallMs - bodyMs),
      cpuUserMs: used.user / 1000,
      cpuSystemMs: used.system / 1000,
    });
  }
  return { files, children };
}
