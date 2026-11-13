import { expect, test } from 'vitest';
import { decodeMarkdown, decodeTable, decodeDiff } from './decode.ts';
test('decodes server previews and rejects malformed cells and diff row kinds', () => {
  expect(decodeMarkdown({ path: 'a.md', html: '<p>hello</p>' }).html).toBe('<p>hello</p>');
  expect(
    decodeTable({
      header: ['a'],
      headerLine: 1,
      rows: [{ line: 2, cells: ['b'] }],
      cols: 1,
      truncated: false,
    }).rows[0]?.cells,
  ).toEqual(['b']);
  expect(
    decodeDiff({
      path: 'a',
      available: true,
      hunks: [
        { oldStart: 1, newStart: 1, rows: [{ type: 'del', text: 'old', oldLine: 1, at: 1 }] },
      ],
    }).hunks[0]?.rows[0]?.at,
  ).toBe(1);
  expect(() => decodeTable({ rows: [{ cells: [42] }] })).toThrow();
  expect(() => decodeDiff({ hunks: [{ rows: [{ type: 'bad' }] }] })).toThrow();
});
