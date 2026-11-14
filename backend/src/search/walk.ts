import type { Item } from '../fuzzy/score.ts';
import { compare } from '../text.ts';
export interface Excluded {
  path: string;
  dir: boolean;
}

function hasPath(files: Item[], entry: Excluded): boolean {
  const prefix = entry.path + (entry.dir ? '/' : '');
  let lo = 0,
    hi = files.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (compare(files[mid]?.path ?? '', prefix) < 0) lo = mid + 1;
    else hi = mid;
  }
  const path = files[lo]?.path;
  return entry.dir ? Boolean(path?.startsWith(prefix)) : path === prefix;
}
function literal(path: string): string {
  return path.replace(/[\\*?[\]{}!]/g, '\\$&');
}

// Only prune known excluded paths. The allow-list still decides every returned hit.
export function walkGlobs(options: {
  files: Item[];
  source: Item[];
  excluded: Excluded[];
}): string[] | undefined {
  const entries: Excluded[] = [
    ...['.git', '.hg', '.svn'].map((path) => ({ path, dir: true })),
    ...options.excluded,
    ...options.source
      .filter((f) => f.size === 0 || f.size > 8 * 1024 * 1024)
      .map((f) => ({ path: f.path, dir: false })),
  ];
  const args: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (hasPath(options.files, entry)) continue;
    const pattern = '!/' + literal(entry.path) + (entry.dir ? '/**' : '');
    bytes += Buffer.byteLength(pattern) + 10;
    if (bytes > 64000) return;
    args.push('--glob', pattern);
  }
  return args;
}
