export interface FindHit {
  line: number;
  col?: number;
  start?: number;
  end?: number;
  n?: number;
}
export function findMatches(text: string, query: string, caseSensitive = false): FindHit[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const hits = [];
  let line = 1;
  let lineStart = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) >= 0) {
    for (let index = lineStart; index < at; index++) {
      if (text[index] === '\n') {
        line++;
        lineStart = index + 1;
      }
    }
    hits.push({ line, col: at - lineStart, start: at, end: at + query.length });
    at += needle.length;
  }
  return hits;
}
export const hitIndex = (index: number, delta: number, total: number): number =>
  total ? (((index + delta) % total) + total) % total : -1;
