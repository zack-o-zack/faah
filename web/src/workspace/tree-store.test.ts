import type { Request, RequestOptions } from '../lib/api.ts';
import { record } from '../lib/decode.ts';
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createTreeStore } from './tree-store.ts';
import { newItemRequest, treeDecoration, copyPath } from './tree-logic.ts';
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request: Request, post: Request = vi.fn(async () => ({}))) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const app = createAppStore();
    app.actions.setWorkspace({ git: false, root: '/workspace' });
    const openFile = vi.fn();
    const tree = createTreeStore(app, { request, post, openFile, enterEditMode: vi.fn() });
    return { app, tree, openFile };
  });
}
test('path shaping and snapshot decorations are pure', () => {
  expect(newItemRequest(' /src/new.js/ ', 'file')).toEqual({ path: 'src/new.js', type: 'file' });
  expect(() => newItemRequest(' / ', 'dir')).toThrow('empty');
  expect(copyPath('src/a.js', 'absolute', '/tmp/')).toBe('/tmp/src/a.js');
  const row = { path: 'a', name: 'a', status: 'M' };
  expect(treeDecoration(row, { statuses: {}, staged: {} }, null, 'all', false).dirty).toBe(false);
  expect(
    treeDecoration(
      row,
      { statuses: { a: 'M' }, staged: { a: true }, partial: { a: true } },
      null,
      'all',
      false,
    ).partial,
  ).toBe(true);
});
test('lazy expansion caches requests, keeps ignored directories closed, and collapses', async () => {
  const request = vi.fn(async (_path: string, params: unknown) => ({
    children: record(params).dir
      ? [{ path: 'src/a.js', name: 'a.js' }]
      : [
          { path: 'src', name: 'src', dir: true },
          { path: 'vendor', name: 'vendor', dir: true, ignored: true },
        ],
  }));
  const { tree } = fixture(request);
  await tree.actions.refreshTree();
  await tree.actions.expandTree(false);
  expect(tree.rows().map((r) => r.path)).toEqual(['src', 'src/a.js', 'vendor']);
  expect(request).toHaveBeenCalledTimes(2);
  await tree.actions.toggleTreeDirectory('src');
  await tree.actions.toggleTreeDirectory('src');
  expect(request).toHaveBeenCalledTimes(2);
  tree.actions.collapseTree();
  expect(tree.rows()).toHaveLength(2);
});
test('replacing a tree view aborts requests and rejects late results', async () => {
  let finish: ((value: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  const request = vi.fn((_path: string, _params?: unknown, opts?: RequestOptions) => {
    signal = opts?.signal || undefined;
    return new Promise<unknown>((resolve) => {
      finish = resolve;
    });
  });
  const { tree } = fixture(request);
  const first = tree.actions.refreshTree();
  const oldSignal = signal;
  const oldFinish = finish;
  const second = tree.actions.refreshTree();
  expect(oldSignal?.aborted).toBe(true);
  if (!finish || !oldFinish) throw new Error('Request did not start');
  finish({ children: [{ path: 'new', name: 'new' }] });
  await second;
  oldFinish({ children: [{ path: 'old', name: 'old' }] });
  await first;
  expect(tree.rows()[0]?.path).toBe('new');
});
test('new item validates paths and reports failures without closing the form', async () => {
  const post = vi.fn().mockRejectedValue(new Error('Permission denied'));
  const { tree } = fixture(vi.fn(), post);
  tree.actions.openNewItem('dir', 'src');
  tree.actions.setNewItemPath('src/new');
  await tree.actions.createItem();
  expect(post.mock.calls[0]?.slice(0, 2)).toEqual(['api/fs/new', { path: 'src/new', type: 'dir' }]);
  expect(tree.state.newItem?.error).toBe('Permission denied');
  expect(tree.state.newItem?.pending).toBe(false);
  tree.actions.closeNewItem();
  expect(tree.state.newItem).toBeNull();
});
