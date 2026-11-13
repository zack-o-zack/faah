import { record, text, number, boolean, list } from '../lib/decode.ts';
export interface SearchMatch {
  line: number;
  pre?: string;
  mid?: string;
  post?: string;
  def?: boolean;
}
export interface NavHit extends SearchMatch {
  path: string;
  ext?: boolean;
}
export interface FileMatches {
  path: string;
  ext?: boolean;
  matches: SearchMatch[];
}
export interface SearchReply {
  results: FileMatches[];
  total?: number;
  files?: number;
  truncated?: boolean;
  header?: string;
}
export function decodeMatch(value: unknown): SearchMatch {
  const v = record(value);
  return {
    line: number(v.line),
    pre: text(v.pre),
    mid: text(v.mid),
    post: text(v.post),
    def: boolean(v.def),
  };
}
export function decodeNavHit(value: unknown): NavHit {
  const v = record(value);
  return { ...decodeMatch(v), path: text(v.path), ext: boolean(v.ext) };
}
export function decodeSearch(value: unknown): SearchReply {
  const v = record(value);
  return {
    results: list(v.results).map((item) => {
      const f = record(item);
      return { path: text(f.path), ext: boolean(f.ext), matches: list(f.matches).map(decodeMatch) };
    }),
    total: number(v.total),
    files: number(v.files),
    truncated: boolean(v.truncated),
    header: text(v.header),
  };
}
