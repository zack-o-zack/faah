export function searchRequest(state) {
  return {
    q: state.query,
    glob: state.glob,
    case: state.caseSensitive ? 1 : '',
    word: state.word ? 1 : '',
    re: state.regex ? 1 : '',
  };
}
export function displayPath(path) {
  return path.length > 48 ? '…/' + path.split('/').slice(-3).join('/') : path;
}
export function groupHits(hits) {
  const groups = new Map();
  for (const hit of hits) {
    if (!groups.has(hit.path)) groups.set(hit.path, { path: hit.path, ext: hit.ext, matches: [] });
    groups.get(hit.path).matches.push(hit);
  }
  return [...groups.values()];
}
export function resultHeading(result) {
  if (result.header) return result.header;
  return `${(result.total || 0).toLocaleString()} results in ${(result.files || 0).toLocaleString()} files${result.truncated ? ' (truncated)' : ''}`;
}
