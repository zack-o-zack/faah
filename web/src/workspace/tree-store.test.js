import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.js';
import { createTreeStore } from './tree-store.js';
import { newItemRequest, treeDecoration, copyPath } from './tree-logic.js';
const disposers = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request, post = vi.fn()) {
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
  const row = { path: 'a', status: 'M' };
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
  const request = vi.fn(async (_, { dir }) => ({
    children: dir
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
  let finish;
  let signal;
  const request = vi.fn((_, params, opts) => {
    signal = opts.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { tree } = fixture(request);
  const first = tree.actions.refreshTree();
  const oldSignal = signal;
  const oldFinish = finish;
  const second = tree.actions.refreshTree();
  expect(oldSignal.aborted).toBe(true);
  finish({ children: [{ path: 'new', name: 'new' }] });
  await second;
  oldFinish({ children: [{ path: 'old', name: 'old' }] });
  await first;
  expect(tree.rows()[0].path).toBe('new');
});
test('new item validates paths and reports failures without closing the form', async () => {
  const post = vi.fn().mockRejectedValue(new Error('Permission denied'));
  const { tree } = fixture(vi.fn(), post);
  tree.actions.openNewItem('dir', 'src');
  tree.actions.setNewItemPath('src/new');
  await tree.actions.createItem();
  expect(post.mock.calls[0].slice(0, 2)).toEqual(['api/fs/new', { path: 'src/new', type: 'dir' }]);
  expect(tree.state.newItem.error).toBe('Permission denied');
  expect(tree.state.newItem.pending).toBe(false);
  tree.actions.closeNewItem();
  expect(tree.state.newItem).toBeNull();
});
