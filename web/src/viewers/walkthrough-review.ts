import type { WalkthroughFile } from '../review/types.ts';

/** New-side rows include context and additions; deleted rows have no workspace line. */
export function reviewRangeText(file: WalkthroughFile, l1: number, l2: number): string | null {
  if (l1 < 1 || l2 < l1) return null;
  const lines = new Map(
    (file.hunks || []).flatMap((hunk) =>
      hunk.rows
        .filter((row) => row.type !== 'del' && !!row.newLine)
        .map((row) => [row.newLine, row.text] as const),
    ),
  );
  const text: string[] = [];
  for (let line = l1; line <= l2; line++) {
    const value = lines.get(line);
    if (value === undefined) return null;
    text.push(value);
  }
  return text.join('\n');
}
export function reviewContainsRange(file: WalkthroughFile, l1: number, l2: number): boolean {
  return reviewRangeText(file, l1, l2) !== null;
}
export const WALK_DIM_OPACITY = 0.3;
