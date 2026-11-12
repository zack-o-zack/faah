import { test, expect } from 'vitest';
import { wordAtColumn } from './hover-position.js';

test('documentation requests identify the whole symbol at the caret', () => {
  expect(wordAtColumn('func reviewChanges() error', 9)).toEqual({word:'reviewChanges',col:5});
  expect(wordAtColumn('  ', 1)).toBeNull();
  expect(wordAtColumn('review', 99)).toEqual({word:'review',col:0});
  expect(wordAtColumn('😀 review', 6)).toEqual({word:'review',col:3});
});
