import { test, expect } from 'vitest';
import { movePosition, selectedText, wordAtColumn } from './cursor.js';
import { findMatches, hitIndex } from './find.js';
import { textChange, indentEdit, textOffsets } from './edit.js';
import { initialVimState, vimKey } from './vim.js';
const lines = ['first second', '', '  third fourth', 'last'];
const textAt = (at) => lines[at] || '';
const doc = {
  line: 1,
  col: 0,
  total: 4,
  textAt,
  pageLines: 20,
  topLine: 1,
  middleLine: 2,
  bottomLine: 4,
  anchor: null,
};

test('cursor crosses empty lines and clamps file boundaries', () => {
  expect(movePosition({ line: 1, col: 0 }, -1, textAt, 4, 'column')).toEqual({ line: 1, col: 0 });
  expect(movePosition({ line: 2, col: 0 }, -1, textAt, 4, 'column')).toEqual({ line: 1, col: 12 });
  expect(movePosition({ line: 4, col: 4 }, 1, textAt, 4, 'column')).toEqual({ line: 4, col: 4 });
  expect(movePosition({ line: 1, col: 0 }, 1, textAt, 4, 'word').col).toBe(6);
  expect(wordAtColumn('😀 review', 6)).toEqual({ word: 'review', col: 3 });
});
test('selection is direction independent and excludes gutter text', () => {
  expect(selectedText({ line: 3, col: 4 }, { line: 1, col: 6 }, textAt).text).toBe(
    'second\n\n  th',
  );
});
test('find handles case, offsets and empty queries without infinite loops', () => {
  expect(findMatches('One one\nONE', 'one').map((hit) => [hit.line, hit.col])).toEqual([
    [1, 0],
    [1, 4],
    [2, 0],
  ]);
  expect(findMatches('One one\nONE', 'one', true)).toHaveLength(1);
  expect(findMatches('text', '')).toEqual([]);
  expect(hitIndex(0, -1, 3)).toBe(2);
});
test('edit changes isolate inserted text and indentation keeps line boundaries', () => {
  expect(textChange('abc', 'abXYc')).toEqual({ start: 2, removed: '', inserted: 'XY' });
  expect(textOffsets('a\n\nb')).toEqual([0, 2, 3]);
  expect(indentEdit('a\nb', 0, 3).replacement).toBe('    a\n    b');
});
function keys(sequence, current = doc) {
  let state = initialVimState();
  let result;
  for (const key of sequence) {
    result = vimKey(state, { key }, current, 10);
    state = result.state;
    current = { ...current, ...result.cursor, anchor: result.anchor };
  }
  return result;
}
test('Vim counts, gg/G, word motions and file boundaries', () => {
  expect(keys(['3', 'j']).cursor.line).toBe(4);
  expect(keys(['k']).cursor.line).toBe(1);
  expect(keys(['G']).cursor.line).toBe(4);
  expect(keys(['3', 'g', 'g']).cursor.line).toBe(3);
  expect(keys(['w']).cursor.col).toBe(6);
  expect(keys(['$', 'l']).cursor).toEqual({ line: 2, col: 0 });
});
test('Vim visual modes, yank operators, registers and Escape', () => {
  const visual = keys(['v', 'w', 'y']);
  expect(visual.state.register).toBe('first ');
  expect(visual.state.mode).toBe('NORMAL');
  expect(visual.anchor).toBeNull();
  expect(keys(['y', 'y']).state.register).toBe('first second');
  expect(keys(['y', 'w']).commands).toEqual([{ type: 'yank', value: 'first ' }]);
  expect(keys(['V', 'j', 'Escape']).state.mode).toBe('NORMAL');
});
test('Vim prefixes expire and browser modifiers fall through', () => {
  const state = { ...initialVimState(), pending: 'g', pendingAt: 1 };
  expect(vimKey(state, { key: 'j' }, doc, 2000).cursor.line).toBe(2);
  expect(vimKey(state, { key: 'p', metaKey: true }, doc, 20).handled).toBe(false);
});
