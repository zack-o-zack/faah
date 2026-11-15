import { afterEach, expect, test, vi } from 'vitest';
import * as intraline from './diff-intraline.ts';
import { splitRows, unifiedRows, type PaintedRow } from './diff-rows.ts';
import type { DiffRow } from './diff-parse.ts';

afterEach(() => vi.restoreAllMocks());

for (const [layout, build] of [
  ['split', splitRows],
  ['unified', unifiedRows],
] as const) {
  test.each([
    ['old value', 'new value'],
    ['ab', 'aXb'],
    ['aXb', 'ab'],
  ])(
    `${layout} rows preserve syntax and skip changed-word work when disabled: %s → %s`,
    (old, next) => {
      const rows: DiffRow[] = [
        { type: 'ctx', oldLine: 1, newLine: 1, text: 'keep' },
        { type: 'del', oldLine: 2, text: old, html: `<i class="k">${old}</i>` },
        { type: 'add', newLine: 2, text: next, html: `<i class="n">${next}</i>` },
        { type: 'add', newLine: 3, text: 'extra' },
      ];
      const ranges = intraline.changedRanges(old, next);
      const changed = vi.spyOn(intraline, 'changedRanges');
      const painted = (highlight: boolean): PaintedRow[] =>
        build(rows, highlight).flatMap((row) =>
          'left' in row ? [row.left, row.right].filter((part) => part !== null) : [row],
        );
      const enabled = painted(true);
      expect(changed).toHaveBeenCalledExactlyOnceWith(old, next);
      expect(enabled.find((row) => row.type === 'del')?.parts).toEqual(
        intraline.syntaxParts(old, rows[1]?.html, ranges.old, ranges.oldBars, 'del'),
      );
      expect(enabled.find((row) => row.type === 'add')?.parts).toEqual(
        intraline.syntaxParts(next, rows[2]?.html, ranges.next, ranges.newBars, 'add'),
      );
      changed.mockClear();
      const disabled = painted(false);
      expect(changed).not.toHaveBeenCalled();
      expect(
        disabled.some((row) => row.parts.some((part) => part.className.includes('diff-char-'))),
      ).toBe(false);
      expect(disabled).toEqual(
        enabled.map((row) => ({ ...row, parts: intraline.syntaxParts(row.text, row.html) })),
      );
      expect(disabled.find((row) => row.type === 'del')?.parts).toEqual([
        { text: old, className: 'k' },
      ]);
      expect(disabled.find((row) => row.type === 'add')?.parts).toEqual([
        { text: next, className: 'n' },
      ]);
    },
  );
}
