import { test, expect } from 'bun:test';
import { renderTable, sniffDelimiter, delimiter, maxBytes } from '../src/table/service.ts';
const table = (s: string, fallback = ',', size = Buffer.byteLength(s)) =>
  renderTable(Buffer.from(s), size, fallback);
test('Go CSV vectors retain physical lines, quoted cells, ragged fields, BOM and LazyQuotes', () => {
  const r = table('repo,note\nchromium,"monorepo,\ndepot_tools excluded"\nvscode,warm\n');
  expect(r.rows).toEqual([
    { line: 2, cells: ['chromium', 'monorepo,\ndepot_tools excluded'] },
    { line: 4, cells: ['vscode', 'warm'] },
  ]);
  expect(table('a,b,c\n1\n1,2,3,4\n').cols).toBe(4);
  expect(table('\uFEFFid,name\n1,x\n').header).toEqual(['id', 'name']);
  expect(table('a,b\n\n1,2\n\n\n3,4\n').rows.map((r) => r.line)).toEqual([3, 6]);
  expect(table('a,b\n5" pipe,x\n').rows[0]?.cells).toEqual(['5" pipe', 'x']);
  expect(table('a,b\n"unfinished')).toMatchObject({
    rows: [{ line: 2, cells: ['unfinished'] }],
    truncated: false,
  });
  expect(table('a,b\n"a",').rows[0]?.cells).toEqual(['a', '']);
  expect(table('a,b\r\n"a\r\nb",c\r\n').rows[0]?.cells).toEqual(['a\nb', 'c']);
  expect(table('')).toEqual({ header: [], headerLine: 0, rows: [], cols: 0, truncated: false });
});
test('Go delimiter vectors use first nonblank line and extension as tie breaker', () => {
  for (const [source, fallback, cells] of [
    ['date\tplace\tnote\n2018\tLondon\tx, y\n', ',', ['2018', 'London', 'x, y']],
    ['a;b;c\n1,5;2;3\n', ',', ['1,5', '2', '3']],
    ['a|b\n1|2\n', ',', ['1', '2']],
    ['a,b\n1,2\n', '\t', ['1', '2']],
    ['"a,b,c"\tz\n1\t2\n', ',', ['1', '2']],
    ['\n\na\tb\n1\t2\n', ',', ['1', '2']],
    ['name\nx\n', ',', ['x']],
  ] as const)
    expect(table(source, fallback).rows[0]?.cells).toEqual([...cells]);
  expect(sniffDelimiter('a,b\tc\n', '\t')).toBe('\t');
  expect(sniffDelimiter('a,b\tc\n', ',')).toBe(',');
  expect(delimiter('A.CSV')).toBe(',');
  expect(delimiter('a.txt')).toBeUndefined();
});
test('Go record and byte caps distinguish exact bounds and drop the final cut record', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => String(i)).join('\n');
  expect(table('n\n' + rows + '\n').truncated).toBe(false);
  expect(table('n\n' + rows + '\nextra\n')).toMatchObject({
    truncated: true,
    rows: expect.arrayContaining([{ line: 1001, cells: ['999'] }]),
  });
  const source = 'a,b\n' + ('x'.repeat(10000) + ',end\n').repeat(200);
  const result = table(source);
  expect(result.truncated).toBe(true);
  expect(result.rows.length).toBeGreaterThan(0);
  for (const row of result.rows) expect(row.cells[1]).toBe('end');
  expect(table('a,b\n1,2\n', ',', maxBytes).truncated).toBe(false);
});
