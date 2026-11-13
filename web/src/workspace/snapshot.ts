import type { GitSnapshot } from './decode.ts';
export function workspacePatch(snapshot: GitSnapshot): GitSnapshot {
  const patch: GitSnapshot = {};
  if (snapshot.git !== undefined) patch.git = snapshot.git;
  if (snapshot.gitChanges !== undefined) patch.gitChanges = snapshot.gitChanges;
  if (snapshot.gitFiles !== undefined) patch.gitFiles = snapshot.gitFiles;
  if (snapshot.branch !== undefined) patch.branch = snapshot.branch;
  if (snapshot.ahead !== undefined) patch.ahead = snapshot.ahead;
  if (snapshot.behind !== undefined) patch.behind = snapshot.behind;
  return patch;
}
export function streamPath(topics: Record<string, boolean>, threads: Map<string, number>): string {
  const params = new URLSearchParams();
  for (const [name, enabled] of Object.entries(topics)) if (enabled) params.set(name, '1');
  for (const id of threads.keys()) params.append('thread', id);
  const query = params.toString();
  return 'api/stream' + (query ? '?' + query : '');
}
