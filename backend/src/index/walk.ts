import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { IgnoreSet, readGitignore } from '../ignore/service.ts';
import { newItem, type Item } from '../fuzzy/score.ts';
import { compare, lower } from '../text.ts';
import type { Node } from './types.ts';
export const vcs = new Set(['.git', '.hg', '.svn']);
export function sortNodes(kids: Node[]): Node[] {
  return kids.sort(
    (a, b) => Number(b.dir) - Number(a.dir) || compare(lower(a.name), lower(b.name)),
  );
}
interface Job {
  rel: string;
  ignore: IgnoreSet;
}
export async function walk(options: {
  root: string;
  publish: (nodes: Node[]) => void;
}): Promise<{ files: Item[]; children: Map<string, Node[]> }> {
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
      entries.sort((a, b) => compare(a.name, b.name));
      const ignore = job.ignore.child(await readGitignore(abs, job.rel));
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
          const info = await stat(join(options.root, rel));
          kids.push({ name: entry.name, path: rel, dir: false, size: info.size });
          files.push(newItem(rel, info.size, true));
        } catch {
          continue;
        }
      }
      children.set(job.rel, sortNodes(kids));
      if (job.rel === '') options.publish(kids);
    };
    drain();
  });
  files.sort((a, b) => compare(a.path, b.path));
  return { files, children };
}
