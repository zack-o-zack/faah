import type { TreeEntry, TreeRow, GitSnapshot } from './decode.ts';
/** A tree cache stays plain: large snapshots are not deep-proxied UI state. */
export function createTreeModel(): TreeModel {
  const children = new Map<string, TreeEntry[]>();
  const expanded = new Set<string>();
  const rows = new Map<string, TreeRow>();
  const directories = new Set<string>();
  const entriesByPath = new Map<string, TreeEntry>();
  function apply(dir: string, entries: TreeEntry[]): void {
    for (const entry of children.get(dir) || []) {
      directories.delete(entry.path);
      entriesByPath.delete(entry.path);
      rows.delete(entry.path);
    }
    children.set(dir, entries);
    for (const entry of entries) {
      entriesByPath.set(entry.path, entry);
      if (entry.dir) directories.add(entry.path);
    }
    for (const entry of entries) rows.delete(entry.path);
  }
  function flatten(scope: string = 'all', snapshot?: GitSnapshot | null): TreeRow[] {
    const result: TreeRow[] = [];
    const stack = [{ entries: children.get('') || [], index: 0, depth: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      if (frame.index >= frame.entries.length) {
        stack.pop();
        continue;
      }
      const entry = frame.entries[frame.index++];
      if (!entry) continue;
      if (!inScope(entry, scope, snapshot)) continue;
      let row = rows.get(entry.path);
      if (!row || row.depth !== frame.depth) {
        row = { ...entry, depth: frame.depth };
        rows.set(entry.path, row);
      }
      result.push(row);
      if (entry.dir && expanded.has(entry.path)) {
        stack.push({ entries: children.get(entry.path) || [], index: 0, depth: frame.depth + 1 });
      }
    }
    return result;
  }
  return {
    children,
    expanded,
    entry: (path: string) => entriesByPath.get(path),
    apply,
    flatten,
    expand(path: string) {
      expanded.add(path);
    },
    collapse(path: string) {
      expanded.delete(path);
    },
    collapseAll() {
      expanded.clear();
    },
    clear() {
      children.clear();
      expanded.clear();
      rows.clear();
      directories.clear();
      entriesByPath.clear();
    },
    ancestors(path: string) {
      const parts = path.split('/');
      const found = [];
      for (let index = 1; index < parts.length; index++) {
        const candidate = parts.slice(0, index).join('/');
        if (directories.has(candidate)) found.push(candidate);
      }
      return found;
    },
    expandable(scope: string = 'all', snapshot?: GitSnapshot | null) {
      return flatten(scope, snapshot).filter(
        (entry) => entry.dir && !entry.ignored && !expanded.has(entry.path),
      );
    },
  };
}
export function inScope(entry: TreeEntry, scope: string, snapshot?: GitSnapshot | null): boolean {
  if (scope === 'all') return true;
  if (scope === 'yours') {
    if (snapshot)
      return entry.dir
        ? !!snapshot.yourDirtyDirs?.[entry.path]
        : !!snapshot.yourStatuses?.[entry.path];
    return entry.dir ? !!entry.yourDirty : !!entry.yourStatus;
  }
  if (snapshot)
    return entry.dir ? !!snapshot.dirtyDirs?.[entry.path] : !!snapshot.statuses?.[entry.path];
  return entry.dir ? !!entry.dirty : !!entry.status;
}
export function rowWindow(
  count: number,
  top: number,
  height: number,
  rowHeight = 24,
  overscan = 12,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  return {
    first: Math.min(first, count),
    last: Math.min(count, Math.ceil((top + height) / rowHeight) + overscan),
  };
}

export interface TreeModel {
  children: Map<string, TreeEntry[]>;
  expanded: Set<string>;
  entry: (path: string) => TreeEntry | undefined;
  apply: (dir: string, entries: TreeEntry[]) => void;
  flatten: (scope?: string, snapshot?: GitSnapshot | null) => TreeRow[];
  expand: (path: string) => void;
  collapse: (path: string) => void;
  collapseAll: () => void;
  clear: () => void;
  ancestors: (path: string) => string[];
  expandable: (scope?: string, snapshot?: GitSnapshot | null) => TreeRow[];
}
