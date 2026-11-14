import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Item } from '../fuzzy/score.ts';
import type { Match } from './service.ts';

// rg ignores a final empty line; Go's per-line scanner searches it once more.
export async function finishNullable(options: {
  root: string;
  files: Item[];
  results: Map<string, Match[]>;
  maxFiles: number;
  maxPerFile: number;
  signal: AbortSignal;
}): Promise<void> {
  const { root, files, results, maxFiles, maxPerFile, signal } = options;
  for (const file of files) {
    signal.throwIfAborted();
    if (results.size >= maxFiles && !results.has(file.path)) continue;
    const matches = results.get(file.path) ?? [];
    if (matches.length >= maxPerFile) continue;
    const data = await readFile(join(root, file.path)).catch(() => undefined);
    if (!data || data.subarray(0, 8000).includes(0) || data.at(-1) !== 10) continue;
    let line = 1;
    for (const byte of data) if (byte === 10) line++;
    matches.push({ line, pre: '', mid: '', post: '' });
    results.set(file.path, matches);
  }
}
