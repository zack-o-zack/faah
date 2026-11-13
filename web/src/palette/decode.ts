import { record, text, number, boolean, list } from '../lib/decode.ts';
export function decodeFinder(value: unknown): {
  indexing: boolean;
  results: { path: string; name: string; pos: number[] }[];
} {
  const v = record(value);
  return {
    indexing: boolean(v.indexing),
    results: list(v.results).map((item) => {
      const f = record(item);
      return {
        path: text(f.path),
        name: text(f.name),
        pos: list(f.pos).map((item) => number(item)),
      };
    }),
  };
}
