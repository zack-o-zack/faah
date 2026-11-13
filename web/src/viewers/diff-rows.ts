import type { DiffRow, DiffHunk } from './diff-parse.ts';
import type { SyntaxPart } from './diff-intraline.ts';
interface RowPair {
  left: DiffRow | null;
  right: DiffRow | null;
}
interface PaintedRow extends DiffRow {
  parts: SyntaxPart[];
}
interface PaintedPair {
  left: PaintedRow | null;
  right: PaintedRow | null;
}
import { changedRanges, syntaxParts } from './diff-intraline.ts';

export function pairRows(rows: DiffRow[]): RowPair[] {
  const pairs = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) break;
    if (row.type === 'ctx') {
      pairs.push({ left: row, right: row });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i]?.type === 'del') dels.push(rows[i++] ?? row);
    while (i < rows.length && rows[i]?.type === 'add') adds.push(rows[i++] ?? row);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      pairs.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return pairs;
}
function parts(
  row: DiffRow | null,
  mask?: Uint8Array,
  bars?: Set<number>,
  kind?: string,
): PaintedRow | null {
  return row ? { ...row, parts: syntaxParts(row.text || '', row.html, mask, bars, kind) } : null;
}
export function splitRows(rows: DiffRow[]): PaintedPair[] {
  return pairRows(rows).map(({ left, right }) => {
    if (left?.type === 'del' && right?.type === 'add') {
      const ranges = changedRanges(left.text, right.text);
      return {
        left: parts(left, ranges.old, ranges.oldBars, 'del'),
        right: parts(right, ranges.next, ranges.newBars, 'add'),
      };
    }
    return { left: parts(left), right: parts(right) };
  });
}
export function unifiedRows(rows: DiffRow[]): PaintedRow[] {
  const paired = splitRows(rows);
  const byRow = new Map<number | undefined, PaintedRow>();
  for (const pair of paired) {
    if (pair.left) byRow.set(pair.left.oldLine, pair.left);
  }
  const right = new Map(
    paired.filter((pair) => pair.right).map((pair) => [pair.right?.newLine, pair.right]),
  );
  return rows.map(
    (row) =>
      (row.type === 'del' ? byRow.get(row.oldLine) : right.get(row.newLine)) ?? {
        ...row,
        parts: syntaxParts(row.text, row.html),
      },
  );
}
export function gutterAnchor(row: DiffRow | null | undefined): {
  line?: number;
  at?: number;
  oldLine?: number;
} {
  return row
    ? {
        line: row.newLine,
        at: row.newLine === undefined ? row.at : undefined,
        oldLine: row.oldLine,
      }
    : {};
}
export function diagnosticMap<T extends { line: number; severity: number }>(
  diagnostics: T[] = [],
): Map<number, T> {
  const map = new Map<number, T>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.line && (!map.has(diagnostic.line) || diagnostic.severity === 1))
      map.set(diagnostic.line, diagnostic);
  }
  return map;
}
export function expandContext(
  hunk: DiffHunk,
  raw: string[],
  html: string[] = [],
  step = 15,
): DiffHunk {
  const first = hunk.rows[0];
  if (!first) return hunk;
  const firstOld = first.oldLine ?? hunk.oldStart ?? 1;
  const firstNew = first.newLine ?? first.at ?? hunk.newStart ?? 1;
  let lastOld = firstOld;
  let lastNew = firstNew;
  for (const row of hunk.rows) {
    if (row.oldLine !== undefined) lastOld = row.oldLine;
    if (row.newLine !== undefined) lastNew = row.newLine;
  }
  const preCount = Math.min(step, Math.max(0, Math.min(firstOld - 1, firstNew - 1)));
  const rows: DiffRow[] = [];
  for (let k = preCount; k >= 1; k--)
    rows.push({
      type: 'ctx',
      oldLine: firstOld - k,
      newLine: firstNew - k,
      text: raw[firstNew - k - 1] || '',
      html: html[firstNew - k - 1] || '',
    });
  rows.push(...hunk.rows);
  for (let k = 1; k <= Math.min(step, Math.max(raw.length, html.length) - lastNew); k++)
    rows.push({
      type: 'ctx',
      oldLine: lastOld + k,
      newLine: lastNew + k,
      text: raw[lastNew + k - 1] || '',
      html: html[lastNew + k - 1] || '',
    });
  return { ...hunk, rows, oldStart: firstOld - preCount, newStart: firstNew - preCount };
}
export function commitStepTarget(
  files: { binary?: boolean }[],
  index: number,
  direction: number,
): number {
  for (let next = index + direction; next >= 0 && next < files.length; next += direction)
    if (!files[next]?.binary) return next;
  return -1;
}
export function rowOffsets(
  count: number,
  heights: Map<number, number>,
  estimate = 20,
): Float64Array {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = (offsets[i] ?? 0) + (heights.get(i) || estimate);
  return offsets;
}
export function measuredWindow(
  offsets: Float64Array,
  top: number,
  height: number,
  overscan = 20,
): { start: number; end: number; before: number; after: number } {
  const count = offsets.length - 1;
  if (count <= 400) return { start: 0, end: count, before: 0, after: 0 };
  function at(value: number): number {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((offsets[mid + 1] ?? 0) <= value) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  const start = Math.max(0, at(Math.max(0, top)) - overscan);
  const end = Math.min(count, at(Math.max(0, top) + height) + overscan + 1);
  return {
    start,
    end,
    before: offsets[start] ?? 0,
    after: (offsets[count] ?? 0) - (offsets[end] ?? 0),
  };
}

export function gutterSelection(
  row: DiffRow | null | undefined,
  path: string,
  reviewable = true,
): {
  path: string;
  text: string;
  l1: number;
  l2: number;
  delL1?: number;
  delL2?: number;
  fromDiff: boolean;
  side: string;
  reviewable: boolean;
} | null {
  if (!row) return null;
  const deleted = row.newLine === undefined;
  const l1 = deleted ? Math.max(1, (row.at || 1) - 1) : (row.newLine ?? 1);
  return {
    path,
    text: row.text || '',
    l1,
    l2: deleted ? Math.max(l1, row.at || 1) : l1,
    delL1: deleted ? row.oldLine : 0,
    delL2: deleted ? row.oldLine : 0,
    fromDiff: true,
    side: deleted ? 'LEFT' : 'RIGHT',
    reviewable,
  };
}
