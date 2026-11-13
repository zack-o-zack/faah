import { record, text, number, boolean, list, strings } from '../lib/decode.ts';
import type { DiffRow, DiffHunk } from './diff-parse.ts';
export interface MarkdownReply {
  path: string;
  html: string;
}
export interface TableReply {
  header: string[];
  headerLine: number;
  rows: { line: number; cells: string[] }[];
  cols: number;
  truncated: boolean;
}
export interface DiffReply {
  path: string;
  diff: string;
  available: boolean;
  ref: string;
  base: string;
  hunks: DiffHunk[];
  prDiff?: string;
  yourDiff?: string;
  prHunks?: DiffHunk[];
  yourHunks?: DiffHunk[];
}
export function decodeMarkdown(value: unknown): MarkdownReply {
  const v = record(value);
  return { path: text(v.path), html: text(v.html) };
}
export function decodeTable(value: unknown): TableReply {
  const v = record(value);
  return {
    header: strings(v.header),
    headerLine: number(v.headerLine),
    rows: list(v.rows).map((item) => {
      const row = record(item);
      return { line: number(row.line), cells: strings(row.cells) };
    }),
    cols: number(v.cols),
    truncated: boolean(v.truncated),
  };
}
function decodeRow(value: unknown): DiffRow {
  const v = record(value);
  const type = v.type;
  if (type !== 'ctx' && type !== 'add' && type !== 'del') throw new Error('Invalid diff row type');
  return {
    type,
    text: text(v.text),
    html: text(v.html),
    oldLine: v.oldLine === undefined ? undefined : number(v.oldLine),
    newLine: v.newLine === undefined ? undefined : number(v.newLine),
    at: v.at === undefined ? undefined : number(v.at),
  };
}
export function decodeHunks(value: unknown): DiffHunk[] {
  return list(value).map((item) => {
    const h = record(item);
    return {
      oldStart: number(h.oldStart),
      newStart: number(h.newStart),
      section: text(h.section),
      rows: list(h.rows).map(decodeRow),
    };
  });
}
export function decodeDiff(value: unknown): DiffReply {
  const v = record(value);
  return {
    path: text(v.path),
    diff: text(v.diff),
    available: boolean(v.available),
    ref: text(v.ref),
    base: text(v.base),
    hunks: decodeHunks(v.hunks),
    prDiff: v.prDiff === undefined ? undefined : text(v.prDiff),
    yourDiff: v.yourDiff === undefined ? undefined : text(v.yourDiff),
    prHunks: v.prHunks === undefined ? undefined : decodeHunks(v.prHunks),
    yourHunks: v.yourHunks === undefined ? undefined : decodeHunks(v.yourHunks),
  };
}
