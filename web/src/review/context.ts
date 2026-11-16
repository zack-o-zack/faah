import type { DiffHunk, DiffRow } from '../viewers/diff-parse.ts';
import type { WalkthroughFile } from './types.ts';

export interface ContextLine {
  text: string;
  html: string;
}
export interface ContextRange {
  from: number;
  to: number;
}

export function mergeRanges(ranges: ContextRange[]): ContextRange[] {
  const result: ContextRange[] = [];
  for (const range of ranges.slice().sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
  }
  return result;
}

export function missingLines(
  file: WalkthroughFile,
  l1: number,
  l2: number,
  pad = 3,
): ContextRange[] {
  const present = new Set(
    (file.hunks || []).flatMap((hunk) =>
      hunk.rows.filter((row) => row.type !== 'del').map((row) => row.newLine),
    ),
  );
  const ranges: ContextRange[] = [];
  for (let line = Math.max(1, l1 - pad); line <= l2 + pad; line++) {
    if (present.has(line)) continue;
    const last = ranges.at(-1);
    if (last?.to === line - 1) last.to = line;
    else ranges.push({ from: line, to: line });
  }
  return ranges;
}

const mergedFiles = new WeakMap<
  WalkthroughFile,
  WeakMap<ReadonlyMap<number, ContextLine>, WalkthroughFile>
>();

/** Add head context without changing original row order or file statistics. */
export function withContext(
  file: WalkthroughFile,
  extra: ReadonlyMap<number, ContextLine>,
): WalkthroughFile {
  if (!extra.size || file.status === 'D') return file;
  let cache = mergedFiles.get(file);
  const cached = cache?.get(extra);
  if (cached) return cached;
  const hunks = file.hunks || [];
  const present = new Set(hunks.flatMap((hunk) => hunk.rows.map((row) => row.newLine)));
  function bounds(hunk: DiffHunk) {
    const first = hunk.rows[0];
    return {
      start: first?.newLine ?? first?.at ?? hunk.newStart,
      end: Math.max(
        hunk.newStart - 1,
        ...hunk.rows.map((row) => row.newLine ?? (row.at ?? hunk.newStart) - 1),
      ),
    };
  }
  function oldLine(line: number): number {
    let previous: DiffHunk | undefined;
    for (const hunk of hunks) {
      if (bounds(hunk).end < line) previous = hunk;
      else break;
    }
    if (previous) {
      let lastOld = previous.oldStart;
      let lastNew = previous.newStart - 1;
      for (const row of previous.rows) {
        if (row.oldLine !== undefined) lastOld = row.oldLine;
        if (row.newLine !== undefined) lastNew = row.newLine;
      }
      return line - lastNew + lastOld;
    }
    const first = hunks[0];
    if (!first) return line;
    const firstOld = first.oldStart + (first.rows.every((row) => row.type === 'add') ? 1 : 0);
    return line - (first.newStart - firstOld);
  }
  const added: DiffRow[] = [...extra]
    .filter(([line]) => line >= 1 && !present.has(line))
    .sort(([a], [b]) => a - b)
    .map(([line, value]) => ({ type: 'ctx', oldLine: oldLine(line), newLine: line, ...value }));
  if (!added.length) return file;
  const blocks = [
    ...hunks.map((hunk) => ({
      ...bounds(hunk),
      oldStart: hunk.oldStart,
      rows: hunk.rows,
      section: hunk.section,
      original: true,
    })),
    ...added.map((row) => ({
      start: row.newLine || 1,
      oldStart: row.oldLine || 0,
      end: row.newLine || 1,
      rows: [row],
      section: '',
      original: false,
    })),
  ].sort((a, b) => a.start - b.start || Number(b.original) - Number(a.original));
  const groups: typeof blocks = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (last && block.start <= last.end + 1) {
      last.rows.push(...block.rows);
      last.end = Math.max(last.end, block.end);
      if (!last.original && block.original) last.section = block.section;
      last.original ||= block.original;
    } else groups.push({ ...block, rows: block.rows.slice() });
  }
  const result = {
    ...file,
    hunks: groups.map((group) => ({
      oldStart: group.rows[0]?.oldLine ?? group.oldStart,
      newStart: group.rows[0]?.newLine ?? group.rows[0]?.at ?? 0,
      section: group.section,
      rows: group.rows,
    })),
  };
  if (!cache) {
    cache = new WeakMap();
    mergedFiles.set(file, cache);
  }
  cache.set(extra, result);
  return result;
}
