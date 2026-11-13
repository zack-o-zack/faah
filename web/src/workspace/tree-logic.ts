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
const FILE_KIND: Record<string, string> = {
  go: 'code',
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  rb: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  swift: 'code',
  lua: 'code',
  ex: 'code',
  exs: 'code',
  scala: 'code',
  dart: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',
  json: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  ini: 'data',
  xml: 'data',
  csv: 'data',
  env: 'data',
  lock: 'data',
  mod: 'data',
  sum: 'data',
  md: 'doc',
  markdown: 'doc',
  txt: 'doc',
  rst: 'doc',
  adoc: 'doc',
  html: 'web',
  htm: 'web',
  css: 'web',
  scss: 'web',
  less: 'web',
  svg: 'web',
  vue: 'web',
  png: 'img',
  jpg: 'img',
  jpeg: 'img',
  gif: 'img',
  webp: 'img',
  ico: 'img',
  avif: 'img',
};
export function fileKind(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 && FILE_KIND[name.slice(dot + 1).toLowerCase()]) || 'other';
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
