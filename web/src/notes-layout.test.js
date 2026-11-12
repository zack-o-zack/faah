import { test, expect } from 'bun:test';
import { indentCols, splitNotes, stackTops, noteKey, peekGroups } from './notes-layout.js';

const note = (kind, l1, l2, extra = {}) => ({ thread: 't', turn: 1, index: l1, kind, path: 'a.go', l1, l2, summary: kind + l1, ...extra });

test('a ghost lines up with the indent of its code', () => {
  expect(indentCols('<span class="k">\tfunc</span>')).toBe(4);
  expect(indentCols('\t<span>x</span>')).toBe(4);
  expect(indentCols('  \tx')).toBe(4);
  expect(indentCols('    x')).toBe(4);
  expect(indentCols('')).toBe(0);
});

test('symbol and line notes become ghosts by line; blocks go to the column in order', () => {
  const { ghosts, blocks } = splitNotes([note('block', 9, 12), note('symbol', 4, 4), note('line', 4, 4), note('block', 2, 3)]);
  expect([...ghosts.keys()]).toEqual([4]);
  expect(ghosts.get(4).map(n => n.kind)).toEqual(['symbol', 'line']);
  expect(blocks.map(n => n.l1)).toEqual([2, 9]);
  expect(noteKey(blocks[0])).toBe('t:1:2');
});

test('cards keep their order and never overlap', () => {
  expect(stackTops([{ top: 0, height: 50 }, { top: 20, height: 30 }, { top: 200, height: 10 }], 6)).toEqual([0, 56, 200]);
});

test('nearby notes share a peek and long blocks are cut', () => {
  const groups = peekGroups([note('line', 53, 53), note('symbol', 52, 52), note('line', 55, 55), note('block', 70, 90), note('line', 99, 99)]);
  expect(groups.map(g => g.lines)).toEqual([[52, 53, 54, 55], [70, 71, 72, 73, 74, 75, 0, 90], [99]]);
  expect(groups[0].notes.map(n => n.l1)).toEqual([52, 53, 55]);
  expect(peekGroups([note('block', 1, 3), note('line', 6, 6)]).map(g => g.lines)).toEqual([[1, 2, 3, 4, 5, 6]]);
});
