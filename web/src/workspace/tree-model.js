/** A tree cache stays plain: large snapshots are not deep-proxied UI state. */
export function createTreeModel() {
  const children = new Map();
  const expanded = new Set();
  const rows = new Map();
  const directories = new Set();
  function apply(dir, entries) {
    for (const entry of children.get(dir) || []) directories.delete(entry.path);
    children.set(dir, entries);
    for (const entry of entries) if (entry.dir) directories.add(entry.path);
    for (const entry of entries) rows.delete(entry.path);
  }
  function flatten(scope = 'all') {
    const result = [];
    const stack = [{ entries: children.get('') || [], index: 0, depth: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.entries.length) {
        stack.pop();
        continue;
      }
      const entry = frame.entries[frame.index++];
      if (!inScope(entry, scope)) continue;
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
    apply,
    flatten,
    expand(path) {
      expanded.add(path);
    },
    collapse(path) {
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
    },
    ancestors(path) {
      const parts = path.split('/');
      const found = [];
      for (let index = 1; index < parts.length; index++) {
        const candidate = parts.slice(0, index).join('/');
        if (directories.has(candidate)) found.push(candidate);
      }
      return found;
    },
    expandable(scope = 'all') {
      return flatten(scope).filter(
        (entry) => entry.dir && !entry.ignored && !expanded.has(entry.path),
      );
    },
  };
}
export function inScope(entry, scope) {
  if (scope === 'all') return true;
  if (scope === 'yours') return entry.dir ? !!entry.yourDirty : !!entry.yourStatus;
  return entry.dir ? !!entry.dirty : !!entry.status;
}
export function rowWindow(count, top, height, rowHeight = 24, overscan = 12) {
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  return {
    first: Math.min(first, count),
    last: Math.min(count, Math.ceil((top + height) / rowHeight) + overscan),
  };
}
