import type { NavHit, FileMatches, SearchReply } from './decode.ts';
export interface SearchFields {
  query: string;
  glob: string;
  caseSensitive: boolean;
  word: boolean;
  regex: boolean;
}
export interface SearchParams {
  q: string;
  glob: string;
  case: number | string;
  word: number | string;
  re: number | string;
}
export function searchRequest(state: SearchFields): SearchParams {
  return {
    q: state.query,
    glob: state.glob,
    case: state.caseSensitive ? 1 : '',
    word: state.word ? 1 : '',
    re: state.regex ? 1 : '',
  };
}
export function displayPath(path: string): string {
  return path.length > 48 ? '…/' + path.split('/').slice(-3).join('/') : path;
}
export function groupHits(hits: NavHit[]): FileMatches[] {
  const groups = new Map<string, FileMatches>();
  for (const hit of hits) {
    if (!groups.has(hit.path)) groups.set(hit.path, { path: hit.path, ext: hit.ext, matches: [] });
    groups.get(hit.path)?.matches.push(hit);
  }
  return [...groups.values()];
}
export function resultHeading(result: SearchReply): string {
  if (result.header) return result.header;
  return `${(result.total || 0).toLocaleString()} results in ${(result.files || 0).toLocaleString()} files${result.truncated ? ' (truncated)' : ''}`;
}
