import { expect, test } from 'vitest';
import { decodeSearch } from './decode.ts';
import { decodeFinder } from '../palette/decode.ts';
test('keeps search snippets and finder positions as server values', () => {
  expect(
    decodeSearch({
      results: [{ path: 'a', matches: [{ line: 1, pre: '<', mid: 'x', post: '>' }] }],
    }).results[0]?.matches[0]?.mid,
  ).toBe('x');
  expect(decodeFinder({ results: [{ path: 'a', name: 'a', pos: [0] }] }).results[0]?.pos).toEqual([
    0,
  ]);
  expect(() => decodeFinder({ results: [{ pos: ['0'] }] })).toThrow();
});
