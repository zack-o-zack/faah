const META_FIELDS = ['git', 'gitChanges', 'gitFiles', 'branch', 'ahead', 'behind'];
export function workspacePatch(snapshot) {
  const patch = {};
  for (const field of META_FIELDS) {
    if (snapshot[field] !== undefined) patch[field] = snapshot[field];
  }
  return patch;
}
export function streamPath(topics, threads) {
  const params = new URLSearchParams();
  for (const [name, enabled] of Object.entries(topics)) if (enabled) params.set(name, '1');
  for (const id of threads.keys()) params.append('thread', id);
  const query = params.toString();
  return 'api/stream' + (query ? '?' + query : '');
}
