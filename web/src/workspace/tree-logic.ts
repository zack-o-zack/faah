import type { TreeEntry, GitSnapshot } from './decode.ts';
export const parentPath = (path: string): string =>
  path.slice(0, Math.max(0, path.lastIndexOf('/')));
export function newItemRequest(path: string, type: string): { path: string; type: 'file' | 'dir' } {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (!clean) throw new Error('Path cannot be empty');
  return { path: clean, type: type === 'dir' ? 'dir' : 'file' };
}
export function treeDecoration(
  row: TreeEntry,
  snapshot: GitSnapshot | null,
  pr: { files?: Record<string, string> } | null | undefined,
  scope: string,
  viewed: boolean,
  optimistic?: { staged: boolean },
): TreeDecoration {
  const status = snapshot ? snapshot.statuses?.[row.path] || '' : row.status || '';
  const yours = snapshot ? snapshot.yourStatuses?.[row.path] || '' : row.yourStatus || '';
  let code = status;
  if (scope === 'yours') code = yours || status;
  else if (pr) code = pr.files?.[row.path] || status;
  const staged = optimistic?.staged ?? (snapshot ? !!snapshot.staged?.[row.path] : !!row.staged);
  const partial = !!(
    !optimistic &&
    staged &&
    (snapshot ? !!snapshot.partial?.[row.path] : !!row.partial)
  );
  const directoryDirty = snapshot
    ? Object.keys(snapshot.statuses || {}).some((path) => path.startsWith(row.path + '/'))
    : !!row.dirty;
  return {
    code,
    yours,
    staged,
    partial,
    viewed,
    dirty: row.dir ? directoryDirty : !!status,
    showStage: pr ? !!yours : !!status,
  };
}
export function copyPath(path: string, kind: string, root = ''): string {
  if (kind === 'name') return path.split('/').pop() || '';
  if (kind === 'absolute' && root) return root.replace(/\/+$/, '') + '/' + path;
  return path;
}

export interface TreeDecoration {
  code: string;
  yours: string;
  staged: boolean;
  partial: boolean;
  viewed: boolean;
  dirty: boolean;
  showStage: boolean;
}
