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
  const counts = new Map<string, number>();
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && [',', '\t', ';', '|'].includes(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = extension,
    n = counts.get(extension) ?? 0;
  for (const c of [',', '\t', ';', '|'])
    if ((counts.get(c) ?? 0) > n) {
      best = c;
      n = counts.get(c) ?? 0;
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
        while (this.offset < s.length) {
          const c = s[this.offset];
          if (c === this.separator || c === '\n') break;
          cell += c;
          this.offset++;
        }
        cells.push(cell);
        const end = s[this.offset++];
        if (end === this.separator) continue;
        if (end === '\n') this.line++;
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
