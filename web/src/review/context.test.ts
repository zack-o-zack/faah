import { expect, test } from 'vitest';
import { missingLines, mergeRanges, withContext } from './context.ts';
import type { WalkthroughFile } from './types.ts';
import type { DiffRow } from '../viewers/diff-parse.ts';
import { splitRows, unifiedRows } from '../viewers/diff-rows.ts';

const ctx = (line: number, old = line): DiffRow => ({
  type: 'ctx',
  newLine: line,
  oldLine: old,
  text: `line ${line}`,
});
const file = (): WalkthroughFile => ({
  path: 'a.go',
  status: 'M',
  group: 'core',
  additions: 2,
  deletions: 1,
  hunks: [
    { oldStart: 4, newStart: 4, section: 'first', rows: [ctx(4), ctx(5)] },
    { oldStart: 10, newStart: 10, section: 'second', rows: [ctx(10), ctx(11)] },
  ],
});
const extra = (...lines: number[]) =>
  new Map(
    lines.map((line) => [line, { text: `line ${line}`, html: `<i class=k>line</i> ${line}` }]),
  );
const numbers = (value: WalkthroughFile) =>
  value.hunks?.map((hunk) => hunk.rows.map((row) => row.newLine));

test('partly fills from A end', () =>
  expect(numbers(withContext(file(), extra(6, 7)))).toEqual([
    [4, 5, 6, 7],
    [10, 11],
  ]));
test('partly fills from B start', () =>
  expect(numbers(withContext(file(), extra(8, 9)))).toEqual([
    [4, 5],
    [8, 9, 10, 11],
  ]));
test('fills gap and merges hunks, retaining first original section and counts', () => {
  const original = file();
  const before = structuredClone(original);
  const rows = extra(6, 7, 8, 9);
  const result = withContext(original, rows);
  expect(numbers(result)).toEqual([[4, 5, 6, 7, 8, 9, 10, 11]]);
  expect(result.hunks?.[0]?.section).toBe('first');
  expect(result).toMatchObject({ additions: 2, deletions: 1, status: 'M', group: 'core' });
  expect(original).toEqual(before);
  expect(withContext(original, rows)).toBe(result);
  expect(withContext(original, extra(4, 5))).toBe(original);
});
test('isolated context run becomes a hunk', () => {
  const result = withContext(file(), extra(7, 8));
  expect(numbers(result)).toEqual([
    [4, 5],
    [7, 8],
    [10, 11],
  ]);
  expect(result.hunks?.[1]).toMatchObject({ oldStart: 7, newStart: 7, section: '' });
});
test('context before first hunk has correct starts and section', () => {
  const result = withContext(file(), extra(2, 3));
  expect(result.hunks?.[0]).toMatchObject({ oldStart: 2, newStart: 2, section: 'first' });
  expect(numbers(result)?.[0]).toEqual([2, 3, 4, 5]);
});
test('context after last hunk', () =>
  expect(numbers(withContext(file(), extra(12, 13)))?.[1]).toEqual([10, 11, 12, 13]));
test('moved file with no hunks uses equal old and new numbers', () => {
  const result = withContext({ ...file(), status: 'R', oldPath: 'old.go', hunks: [] }, extra(7, 8));
  expect(result.hunks?.[0]).toMatchObject({
    oldStart: 7,
    newStart: 7,
    section: '',
    rows: [ctx(7), ctx(8)],
  });
});
test('added lines above shift old numbering before and after hunks', () => {
  const original = file();
  original.hunks = [
    {
      oldStart: 2,
      newStart: 4,
      rows: [ctx(4, 2), { type: 'add', newLine: 5, text: 'new' }, ctx(6, 3)],
    },
  ];
  const result = withContext(original, extra(3, 7));
  expect(result.hunks?.[0]?.rows.map((row) => [row.oldLine, row.newLine])).toEqual([
    [1, 3],
    [2, 4],
    [undefined, 5],
    [3, 6],
    [4, 7],
  ]);
});
test('deletions next to merge boundary keep order and influence old numbering', () => {
  const original = file();
  original.hunks = [
    {
      oldStart: 1,
      newStart: 1,
      rows: [ctx(1), { type: 'del', oldLine: 2, at: 2, text: 'deleted' }],
    },
    {
      oldStart: 5,
      newStart: 4,
      rows: [{ type: 'del', oldLine: 5, at: 4, text: 'old' }, ctx(4, 6)],
    },
  ];
  const result = withContext(original, extra(2, 3));
  expect(result.hunks).toHaveLength(1);
  expect(result.hunks?.[0]?.rows.map((row) => [row.type, row.oldLine, row.newLine])).toEqual([
    ['ctx', 1, 1],
    ['del', 2, undefined],
    ['ctx', 3, 2],
    ['ctx', 4, 3],
    ['del', 5, undefined],
    ['ctx', 6, 4],
  ]);
  const rows = result.hunks?.[0]?.rows || [];
  expect(unifiedRows(rows, true).map((row) => row.text)).toEqual(rows.map((row) => row.text));
  expect(
    splitRows(rows, true)
      .filter((pair) => pair.right?.type === 'ctx')
      .every((pair) => pair.left?.oldLine === pair.right?.oldLine),
  ).toBe(true);
});
test('missing lines pads, clamps at one, ignores deletions and merges adjacent ranges', () => {
  expect(missingLines(file(), 2, 8)).toEqual([
    { from: 1, to: 3 },
    { from: 6, to: 9 },
  ]);
  expect(missingLines(file(), 4, 5, 0)).toEqual([]);
  expect(
    mergeRanges([
      { from: 8, to: 9 },
      { from: 2, to: 4 },
      { from: 4, to: 7 },
    ]),
  ).toEqual([{ from: 2, to: 9 }]);
});

test('addition-only hunks preserve their old anchor and number surrounding context', () => {
  const original: WalkthroughFile = {
    path: 'a.go',
    group: 'core',
    hunks: [
      {
        oldStart: 3,
        newStart: 4,
        rows: [
          { type: 'add', newLine: 4, text: 'added' },
          { type: 'add', newLine: 5, text: 'also added' },
        ],
      },
    ],
  };
  const result = withContext(original, extra(3, 6));
  expect(result.hunks?.[0]?.rows.map((row) => [row.oldLine, row.newLine])).toEqual([
    [3, 3],
    [undefined, 4],
    [undefined, 5],
    [4, 6],
  ]);
  expect(withContext(original, extra(6)).hunks?.[0]?.oldStart).toBe(3);
});
