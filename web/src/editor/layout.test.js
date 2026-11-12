import { test, expect } from 'vitest';
import {
  htmlTextLen,
  lineText,
  lineOffsets,
  lineIndexAtY,
  visibleRange,
  codeWidth,
} from './layout.js';

test('highlighted text preserves UTF-16 columns, entities and tab stops', () => {
  expect(lineText('<span class="k">a&lt;b &amp; &#x1F600;</span>')).toBe('a<b & 😀');
  expect(htmlTextLen('<b>ab</b>\t&amp;')).toBe(5);
  expect(htmlTextLen('😀\tx', 8)).toBe(9);
  expect(htmlTextLen()).toBe(0);
});
test('offsets account for wrapped, empty and unloaded lines', () => {
  const columns = new Int32Array([0, 10, 11, -1, 30]);
  expect([
    ...lineOffsets(columns, {
      wrap: true,
      width: 100,
      charWidth: 10,
      lineHeight: 20,
      estimate: 20,
    }),
  ]).toEqual([0, 20, 40, 80, 120, 180]);
  expect([...lineOffsets(columns)]).toEqual([0, 20, 40, 60, 80, 100]);
});
test('binary search clamps empty, negative, exact boundaries and document end', () => {
  const offsets = new Float64Array([0, 20, 60, 80]);
  expect([-1, 0, 19, 20, 59, 60, 80, Infinity].map((y) => lineIndexAtY(offsets, y))).toEqual([
    0, 0, 0, 1, 1, 2, 2, 2,
  ]);
  expect(lineIndexAtY(new Float64Array(1), 10)).toBe(0);
});
test('visible range stays bounded across a fifty-thousand-line document', () => {
  const offsets = lineOffsets(new Int32Array(50000));
  expect(visibleRange(offsets, 0, 600)).toEqual({ first: 0, last: 56 });
  expect(visibleRange(offsets, 400000, 600)).toEqual({ first: 19976, last: 20056 });
  expect(visibleRange(offsets, 1000000, 600).last).toBe(50000);
  expect(visibleRange(new Float64Array(1), 0, 600)).toEqual({ first: 0, last: 0 });
  expect(codeWidth(800, 50000, 8)).toBe(690);
});
test('narrow viewports and huge lines always have a finite positive height', () => {
  const offsets = lineOffsets(new Int32Array([100000]), { wrap: true, width: 0, charWidth: 8 });
  expect(offsets[1]).toBe(2000000);
});
