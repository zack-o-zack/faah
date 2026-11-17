import { expect, test } from 'vitest';
import { indentCols } from './layout.ts';
import { lineOffsets, visibleRange } from '../editor/layout.ts';

test('ghost rows add height without adding source lines, including wrapped measurements', () => {
  const offsets = lineOffsets([8, 8, 8], {
    extraRows: { 1: 2 },
    extraRowHeight: 32,
    heights: new Map([[1, 40]]),
    wrap: true,
  });
  expect([...offsets]).toEqual([0, 20, 124, 144]);
  expect(visibleRange(offsets, 0, 200).last).toBe(3);
  expect(indentCols('<span>\t  hi</span>')).toBe(6);
});
