import { record, text, number, boolean, list, strings } from '../lib/decode.ts';
export interface LspBrief {
  state: string;
  server: string;
  missing?: string;
}
export interface Diagnostic {
  line: number;
  col?: number;
  endLine?: number;
  endCol?: number;
  severity?: number;
  source?: string;
  code?: string | number;
  message: string;
}
export interface FileWindow {
  path: string;
  lang: string;
  total: number;
  maxCols: number;
  start: number;
  lines: string[];
  raw: string[];
  size: number;
  exact: boolean;
  refine: boolean;
  markdown: boolean;
  table: boolean;
  diffAvailable: boolean;
  image: boolean;
  deleted: boolean;
  lsp: LspBrief;
  diagnostics: Diagnostic[];
  unchanged?: boolean;
}
export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  indent: number;
  end?: number;
}
export function decodeLsp(value: unknown): LspBrief {
  const row = value ? record(value) : {};
  return { state: text(row.state, 'off'), server: text(row.server), missing: text(row.missing) };
}
export function decodeDiagnostic(value: unknown): Diagnostic {
  const row = record(value);
  return {
    ...row,
    line: number(row.line),
    col: number(row.col),
    endLine: number(row.endLine),
    endCol: number(row.endCol),
    severity: number(row.severity),
    source: text(row.source),
    code: typeof row.code === 'number' ? row.code : text(row.code),
    message: text(row.message),
  };
}
export function decodeFileWindow(value: unknown): FileWindow {
  const row = record(value);
  return {
    path: text(row.path),
    lang: text(row.lang),
    total: number(row.total),
    maxCols: number(row.maxCols),
    start: number(row.start),
    lines: strings(row.lines),
    raw: strings(row.raw),
    size: number(row.size),
    exact: boolean(row.exact),
    refine: boolean(row.refine),
    markdown: boolean(row.markdown),
    table: boolean(row.table),
    diffAvailable: boolean(row.diffAvailable),
    image: boolean(row.image),
    deleted: boolean(row.deleted),
    lsp: decodeLsp(row.lsp),
    diagnostics: list(row.diagnostics).map(decodeDiagnostic),
  };
}
export function decodeSymbols(value: unknown): {
  symbols: SymbolInfo[];
  state: string;
  server: string;
} {
  const row = record(value);
  return {
    state: text(row.state),
    server: text(row.server),
    symbols: list(row.symbols).map((item) => {
      const sym = record(item);
      return {
        name: text(sym.name),
        kind: text(sym.kind),
        line: number(sym.line),
        indent: number(sym.indent),
        end: number(sym.end),
      };
    }),
  };
}
export interface HoverReply extends LspBrief {
  signature: string;
  doc: string;
  empty: boolean;
}
export function decodeHover(value: unknown): HoverReply {
  const row = record(value);
  return {
    ...decodeLsp(row),
    signature: text(row.signature),
    doc: text(row.doc),
    empty: boolean(row.empty),
  };
}
export interface Match {
  line: number;
  pre: string;
  mid: string;
  post: string;
}
export function decodeFind(value: unknown): { results: { path: string; matches: Match[] }[] } {
  return {
    results: list(record(value).results).map((item) => {
      const row = record(item);
      return {
        path: text(row.path),
        matches: list(row.matches).map((item) => {
          const match = record(item);
          return {
            line: number(match.line),
            pre: text(match.pre),
            mid: text(match.mid),
            post: text(match.post),
          };
        }),
      };
    }),
  };
}
export function decodeSave(value: unknown): { ok: boolean; path: string } {
  const row = record(value);
  return { ok: boolean(row.ok), path: text(row.path) };
}
