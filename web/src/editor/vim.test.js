import { expect, test } from 'vitest';
import { initialVimState, vimKey } from './vim.js';

const lines = ['  first second', '', 'third fourth', 'last'];
function run(keys, patch = {}, previous = initialVimState()) {
  let document = {
    line: 1,
    col: 2,
    total: lines.length,
    textAt: (index) => lines[index] || '',
    anchor: null,
    pageLines: 6,
    topLine: 1,
    middleLine: 2,
    bottomLine: 4,
    tabCount: 3,
    ...patch,
  };
  let result;
  for (const key of keys) {
    const event = typeof key === 'string' ? { key } : key;
    result = vimKey(previous, event, document, 20);
    previous = result.state;
    document = { ...document, ...result.cursor, anchor: result.anchor };
  }
  return result;
}

test.each([
  [['h'], 1, 1],
  [['l'], 1, 3],
  [['2', 'j'], 3, 2],
  [['9', 'k'], 1, 2],
  [['w'], 1, 8],
  [['w', 'b'], 1, 2],
  [['0'], 1, 0],
  [['$'], 1, 14],
  [['0', '^'], 1, 2],
  [['G'], 4, 0],
  [['2', 'G'], 2, 0],
  [['9', 'G'], 4, 0],
  [['G', 'g', 'g'], 1, 0],
  [['3', 'g', 'g'], 3, 0],
  [['H'], 1, 2],
  [['M'], 2, 2],
  [['L'], 4, 2],
])('motion %j reaches line %i column %i', (keys, line, col) => {
  expect(run(keys).cursor).toEqual({ line, col });
});

test.each([
  ['d', 1, 4],
  ['u', 4, 1],
  ['f', 1, 4],
  ['b', 4, 1],
])('Ctrl+%s pages and clamps at document boundaries', (key, line, target) => {
  expect(run([{ key, ctrlKey: true }], { line }).cursor.line).toBe(target);
  expect(run([{ key, ctrlKey: true }], { pageLines: 0 }).handled).toBe(true);
});

test.each([
  [['g', 'd'], 'definition', undefined],
  [['g', 'r'], 'references', undefined],
  [['g', 'h'], 'calls', undefined],
  [['K'], 'hover', undefined],
  [['/'], 'find', 1],
  [['?'], 'find', -1],
  [['n'], 'next', 1],
  [['N'], 'next', -1],
  [[':'], 'palette', undefined],
  [['g', 't'], 'tab', 1],
  [['g', 'T'], 'tab', -1],
  [['2', 'g', 't'], 'tabIndex', 1],
  [['9', 'g', 't'], 'tab', 1],
  [['z', 'z'], 'scroll', 'z'],
  [['z', 't'], 'scroll', 't'],
  [['z', 'b'], 'scroll', 'b'],
  [[{ key: 'o', ctrlKey: true }], 'history', -1],
  [['2', { key: 'i', ctrlKey: true }], 'history', 2],
])('command %j emits %s without services or DOM', (keys, type, value) => {
  expect(run(keys).commands).toEqual([{ type, value }]);
});

test.each([
  ['*', 1],
  ['#', -1],
])('%s searches the word with direction %i', (key, direction) => {
  expect(run([key]).commands).toEqual([
    { type: 'findWord', value: { word: 'first', col: 2, direction } },
  ]);
  expect(run([key], { line: 2 }).commands).toEqual([]);
});

test.each([
  ['Y', 'copy-ref'],
  ['e', 'agent-edit'],
  ['c', 'agent-edit'],
  ['u', 'usages'],
])('visual %s emits %s and exits selection', (key, value) => {
  const result = run(['v', 'w', key]);
  expect(result.commands).toEqual([{ type: 'selection', value }]);
  expect(result.state.mode).toBe('NORMAL');
  expect(result.anchor).toBeNull();
});

test('visual transitions preserve character anchors and select whole lines in both directions', () => {
  expect(run(['v', 'l']).anchor).toEqual({ line: 1, col: 2 });
  expect(run(['v', 'v']).anchor).toBeNull();
  expect(run(['V', 'V']).state.mode).toBe('NORMAL');
  expect(run(['v', 'j', 'V']).anchor).toEqual({ line: 2, col: 0 });
  expect(run(['V', 'v']).state.mode).toBe('VISUAL');
  expect(run(['V', 'j', 'j', 'y']).state.register).toBe(lines.slice(0, 3).join('\n'));
  expect(run(['V', 'k', 'k', 'y'], { line: 3 }).state.register).toBe(lines.slice(0, 3).join('\n'));
  expect(run(['V', 'g', 'g'], { line: 4 }).cursor).toEqual({ line: 1, col: 0 });
});

test('yank operators retain a register, preserve the cursor and clamp counted lines', () => {
  const result = run(['2', 'y', 'y']);
  expect(result.state.register).toBe(lines.slice(0, 2).join('\n'));
  expect(result.cursor).toEqual({ line: 1, col: 2 });
  expect(run(['y', '$']).state.register).toBe('first second');
  expect(run(['9', 'y', 'y'], { line: 4 }).state.register).toBe('last');
});

test('Escape resets counts, prefixes and visual state without consuming an idle Escape', () => {
  expect(run(['Escape']).handled).toBe(false);
  for (const keys of [
    ['2', 'Escape'],
    ['g', 'Escape'],
    ['v', 'Escape'],
    ['V', 'Escape'],
  ]) {
    const result = run(keys);
    expect(result.handled).toBe(true);
    expect(result.state).toMatchObject({ mode: 'NORMAL', count: '', pending: '' });
    expect(result.anchor).toBeNull();
  }
});

test('unknown prefixes are consumed; unknown keys and modified browser keys fall through', () => {
  expect(run(['g', 'x']).commands).toEqual([]);
  expect(run(['z', 'x']).handled).toBe(true);
  for (const event of [
    { key: 'x' },
    { key: 'j', metaKey: true },
    { key: 'j', altKey: true },
    { key: 'j', ctrlKey: true },
  ]) {
    expect(run([event]).handled).toBe(false);
  }
});
