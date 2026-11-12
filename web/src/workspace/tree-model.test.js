import { test, expect } from 'vitest';
import { createTreeModel, rowWindow } from './tree-model.js';
const folder = (path, fields = {}) => ({ path, name: path.split('/').pop(), dir: true, ...fields });
const file = (path, fields = {}) => ({ path, name: path.split('/').pop(), ...fields });
test('lazy compacted folders flatten in server order and preserve row identity', () => {
  const model = createTreeModel();
  model.apply('', [folder('a/b'), file('root.js')]);
  model.apply('a/b', [file('a/b/child.js')]);
  const root = model.flatten();
  expect(root.map((row) => row.path)).toEqual(['a/b', 'root.js']);
  model.expand('a/b');
  expect(model.flatten().map((row) => row.depth)).toEqual([0, 1, 0]);
  expect(model.flatten()[0]).toBe(root[0]);
  expect(model.ancestors('a/b/child.js')).toEqual(['a/b']);
  model.collapseAll();
  expect(model.flatten()).toHaveLength(2);
  expect(model.children.has('a/b')).toBe(true);
});
test('Git scopes keep matching ancestors and ignore clean entries', () => {
  const model = createTreeModel();
  model.apply('', [
    folder('src', { dirty: true, yourDirty: true }),
    folder('ignored', { ignored: true }),
    file('clean'),
    file('pr', { status: 'M' }),
  ]);
  model.apply('src', [file('src/yours', { status: 'M', yourStatus: 'M' }), file('src/clean')]);
  model.expand('src');
  expect(model.flatten('yours').map((row) => row.path)).toEqual(['src', 'src/yours']);
  expect(model.flatten('changed').map((row) => row.path)).toEqual(['src', 'src/yours', 'pr']);
  expect(model.expandable()).toEqual([]);
});
test('twenty thousand rows stay bounded by a virtual window', () => {
  const model = createTreeModel();
  model.apply('', [folder('src')]);
  model.apply(
    'src',
    Array.from({ length: 20000 }, (_, i) => file(`src/${i}.js`)),
  );
  model.expand('src');
  expect(model.flatten()).toHaveLength(20001);
  expect(rowWindow(20001, 24000, 600)).toEqual({ first: 988, last: 1037 });
  expect(rowWindow(0, 0, 600)).toEqual({ first: 0, last: 0 });
  model.clear();
  expect(model.flatten()).toEqual([]);
});
