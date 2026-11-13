import { expect, test } from 'vitest';
import { decodeFileWindow, decodeFind, decodeHover, decodeSymbols, decodeSave } from './decode.ts';
test('file windows decode source and image replies without proxying the lines', () => {
  const source = decodeFileWindow({
    path: 'one.go',
    lines: ['<b>one</b>'],
    start: 0,
    total: 1,
    size: 3,
    lang: 'Go',
    lsp: { state: 'ready', server: 'gopls' },
  });
  expect(source.lines).toEqual(['<b>one</b>']);
  expect(source.lsp.server).toBe('gopls');
  expect(decodeFileWindow({ path: 'image.png', image: true, size: 42 }).image).toBe(true);
  expect(() => decodeFileWindow({ lines: [42] })).toThrow('text');
});
test('hover, symbols, find and save replies validate the fields their actions consume', () => {
  expect(decodeHover({ state: 'ready', signature: '<b>fn</b>', doc: 'Help' }).doc).toBe('Help');
  expect(
    decodeSymbols({ symbols: [{ name: 'main', kind: 'func', line: 3, indent: 0 }] }).symbols[0]
      ?.line,
  ).toBe(3);
  expect(
    decodeFind({ results: [{ path: 'one.go', matches: [{ line: 2, mid: 'word' }] }] }).results[0]
      ?.matches[0]?.mid,
  ).toBe('word');
  expect(decodeSave({ ok: true, path: 'one.go' })).toEqual({ ok: true, path: 'one.go' });
  expect(() => decodeSymbols({ symbols: [{ line: 'three' }] })).toThrow('number');
});
