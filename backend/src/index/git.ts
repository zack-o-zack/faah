import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Node, GitState } from './types.ts';
import { sortNodes } from './walk.ts';
import { compare } from '../text.ts';
export function dirtyPaths(statuses: Record<string, string>): Set<string> {
  const dirty = new Set<string>();
  for (let p of Object.keys(statuses)) {
    while (p.includes('/')) {
      p = p.slice(0, p.lastIndexOf('/'));
      dirty.add(p);
    }
  }
  return dirty;
}
export function gitFiles(state: GitState): string[] {
  return Object.keys(state.statuses).sort(
    (a, b) =>
      Number(state.statuses[a] === 'U') - Number(state.statuses[b] === 'U') || compare(a, b),
  );
}
export function applyFlags(node: Node, state: GitState): void {
  delete node.status;
  delete node.staged;
  delete node.partial;
  delete node.yourStatus;
  delete node.dirty;
  delete node.yourDirty;
  if (node.dir) {
    if (dirtyPaths(state.statuses).has(node.path)) node.dirty = true;
    if (dirtyPaths(state.yourStatuses).has(node.path)) node.yourDirty = true;
  } else {
    const p = node.path;
    if (state.statuses[p]) node.status = state.statuses[p];
    if (state.staged[p]) node.staged = true;
    if (state.partial[p]) node.partial = true;
    if (state.yourStatuses[p]) node.yourStatus = state.yourStatuses[p];
  }
}
export async function mergeGit(options: {
  children: Map<string, Node[]>;
  state: GitState;
  root: string;
  build: boolean;
}): Promise<void> {
  const { children, state, root, build } = options;
  const dirty = dirtyPaths(state.statuses),
    yourDirty = dirtyPaths(state.yourStatuses);
  for (const [dir, kids] of children) {
    const out: Node[] = [];
    for (const node of kids) {
      if (build && node.ignored) {
        out.push(node);
        continue;
      }
      if (
        !node.dir &&
        (node.status === 'D' || node.yourStatus === 'D') &&
        state.statuses[node.path] !== 'D' &&
        state.yourStatuses[node.path] !== 'D'
      ) {
        try {
          await stat(join(root, node.path));
        } catch {
          continue;
        }
      }
      delete node.status;
      delete node.staged;
      delete node.partial;
      delete node.yourStatus;
      delete node.dirty;
      delete node.yourDirty;
      if (node.dir) {
        if (dirty.has(node.path)) node.dirty = true;
        if (yourDirty.has(node.path)) node.yourDirty = true;
      } else {
        const p = node.path;
        if (state.statuses[p]) node.status = state.statuses[p];
        if (state.staged[p]) node.staged = true;
        if (state.partial[p]) node.partial = true;
        if (state.yourStatuses[p]) node.yourStatus = state.yourStatuses[p];
      }
      out.push(node);
    }
    children.set(dir, out);
  }
  for (const p of new Set([...Object.keys(state.statuses), ...Object.keys(state.yourStatuses)])) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = parts.slice(0, i).join('/'),
        sub = parts.slice(0, i + 1).join('/');
      const kids = children.get(parent) ?? [];
      const name = parts[i] ?? '';
      if (!kids.some((n) => n.name === name && n.dir)) {
        const node: Node = { name, path: sub, dir: true, size: 0 };
        if (dirty.has(sub)) node.dirty = true;
        if (yourDirty.has(sub)) node.yourDirty = true;
        kids.push(node);
        children.set(parent, sortNodes(kids));
      }
      if (!children.has(sub)) children.set(sub, []);
    }
    const dir = posix.dirname(p) === '.' ? '' : posix.dirname(p);
    const kids = children.get(dir) ?? [];
    let node = kids.find((n) => n.path === p && !n.dir);
    if (!node) {
      node = { name: posix.basename(p), path: p, dir: false, size: 0 };
      kids.push(node);
      children.set(dir, sortNodes(kids));
    }
    applyFlags(node, state);
  }
  if (!build) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [dir, kids] of children) {
        if (!dir || kids.length) continue;
        try {
          await stat(join(root, dir));
        } catch {
          children.delete(dir);
          const parent = posix.dirname(dir) === '.' ? '' : posix.dirname(dir);
          children.set(
            parent,
            (children.get(parent) ?? []).filter((n) => n.path !== dir),
          );
          changed = true;
          break;
        }
      }
    }
  }
}
