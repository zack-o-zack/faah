import { goString } from '../render/text.ts';
import { extname } from 'node:path';
import { trimSpace } from '../text.ts';
export const maxRows = 1000,
  maxBytes = 1 << 20;
export function delimiter(path: string): string | undefined {
  return extname(path).toLowerCase() === '.csv'
    ? ','
    : extname(path).toLowerCase() === '.tsv'
      ? '\t'
      : undefined;
}
export function sniffDelimiter(head: string, extension: string): string {
  let line = head;
  while (line.length) {
    const i = line.indexOf('\n');
    if (i < 0) break;
    if (trimSpace(line.slice(0, i))) {
      line = line.slice(0, i);
      break;
    }
    line = line.slice(i + 1);
  }
  const separators = [',', '\t', ';', '|'];
  const counts = [0, 0, 0, 0];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code === 34) quoted = !quoted;
    else if (!quoted) {
      const index = code === 44 ? 0 : code === 9 ? 1 : code === 59 ? 2 : code === 124 ? 3 : -1;
      if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  let best = extension,
    n = counts[separators.indexOf(extension)] ?? 0;
  for (let i = 0; i < separators.length; i++)
    if ((counts[i] ?? 0) > n) {
      best = separators[i] ?? extension;
      n = counts[i] ?? 0;
    }
  return best;
}
export interface Table {
  header: string[];
  headerLine: number;
  rows: { line: number; cells: string[] }[];
  cols: number;
  truncated: boolean;
}
// encoding/csv's LazyQuotes mode accepts bare quotes and unterminated quoted
// fields. Only empty physical lines are skipped; CRLF becomes LF even inside
// quoted cells, while a lone final CR is dropped by readLine.
export class CSVReader {
  private offset = 0;
  private line = 1;
  constructor(
    readonly source: string,
    readonly separator: string,
  ) {}
  read(): { line: number; cells: string[] } | undefined {
    const s = this.source;
    while (s[this.offset] === '\n') {
      this.offset++;
      this.line++;
    }
    if (this.offset >= s.length) return;
    const line = this.line,
      cells: string[] = [];
    while (true) {
      let cell = '',
        separated = false;
      if (s[this.offset] === '"') {
        this.offset++;
        while (this.offset < s.length) {
          const c = s[this.offset++] ?? '';
          if (c === '"') {
            const next = s[this.offset];
            if (next === '"') {
              cell += '"';
              this.offset++;
            } else if (next === this.separator) {
              this.offset++;
              cells.push(cell);
              separated = true;
              break;
            } else if (next === '\n') {
              this.offset++;
              this.line++;
              cells.push(cell);
              return { line, cells };
            } else if (next === undefined) {
              cells.push(cell);
              return { line, cells };
            } else cell += '"';
          } else {
            cell += c;
            if (c === '\n') this.line++;
          }
        }
        if (separated) continue;
        if (this.offset >= s.length) {
          cells.push(cell);
          return { line, cells };
        }
      } else {
        const start = this.offset;
        let end = start;
        while (end < s.length && s[end] !== this.separator && s[end] !== '\n') end++;
        cells.push(s.slice(start, end));
        this.offset = end;
        const delimiter = s[this.offset++];
        if (delimiter === this.separator) continue;
        if (delimiter === '\n') this.line++;
        return { line, cells };
      }
    }
  }
}
export function renderTable(input: Uint8Array, size: number, fallback: string): Table {
  const data = Buffer.from(input.buffer, input.byteOffset, Math.min(input.byteLength, maxBytes));
  const comma = sniffDelimiter(data.subarray(0, 64 << 10).toString(), fallback);
  const source = goString(data).replaceAll('\r\n', '\n').replace(/\r$/, '');
  const reader = new CSVReader(source, comma),
    cut = size > maxBytes;
  const result: Table = { header: [], headerLine: 0, rows: [], cols: 0, truncated: false };
  const header = reader.read();
  if (!header) return result;
  result.header = header.cells;
  result.header[0] = (result.header[0] ?? '').replace(/^\uFEFF/, '');
  result.headerLine = header.line;
  result.cols = header.cells.length;
  while (true) {
    const row = reader.read();
    if (!row) break;
    if (result.rows.length === maxRows) {
      result.truncated = true;
      return result;
    }
    result.rows.push(row);
    result.cols = Math.max(result.cols, row.cells.length);
  }
  if (cut) {
    result.rows.pop();
    result.truncated = true;
  }
  return result;
}
