import { expect, test } from 'vitest';
import { stackTops, peekGroups, marginWidth, indentCols } from './layout.ts';
import { lineOffsets, visibleRange } from '../editor/layout.ts';

test('margin cards push overlapping cards down and collapse to dots on narrow editors', () => {
  expect(
    stackTops(
      [
        { top: 20, height: 80 },
        { top: 40, height: 60 },
      ],
      8,
    ),
  ).toEqual([20, 108]);
  expect(marginWidth(700, true)).toBe(24);
  expect(marginWidth(1000, true)).toBe(260);
  expect(marginWidth(1000, false)).toBe(0);
});
test('ghost rows add height without adding source lines, including wrapped measurements', () => {
  const offsets = lineOffsets([8, 8, 8], {
    extraRows: { 1: 2 },
    heights: new Map([[1, 40]]),
    wrap: true,
  });
  expect([...offsets]).toEqual([0, 20, 100, 120]);
  expect(visibleRange(offsets, 0, 200).last).toBe(3);
  expect(indentCols('<span>\t  hi</span>')).toBe(6);
});
test('peeks join nearby notes and bound long blocks', () => {
  const groups = peekGroups([
    { l1: 1, l2: 100 },
    { l1: 102, l2: 102 },
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.lines).toEqual([1, 2, 3, 4, 5, 6, 0, 100, 101, 102]);
});
