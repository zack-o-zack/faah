import { createRoot } from 'solid-js';
import { afterEach, test, expect, vi } from 'vitest';
import { createAppStore } from '../app/store.js';
const disposers = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const makeStore = (options) =>
  createRoot((dispose) => {
    disposers.push(dispose);
    return createAppStore(options);
  });
const fetcher = async (_, { start = 0 }) => ({
  start,
  total: 50000,
  lang: 'go',
  lines: ['<b>one</b>'],
  exact: true,
});

test('document metadata is reactive while buffers stay outside the store', async () => {
  const store = makeStore({ fetcher });
  await store.actions.openDocument('one.go');
  expect(store.state.documents.tabs[0]).toMatchObject({ path: 'one.go', cur: 1, total: 50000 });
  expect(store.state.documents.tabs[0].lines).toBeUndefined();
  expect(store.buffers.get('one.go').lines).toHaveLength(50000);
  store.actions.patchDocument('one.go', { cur: 15, col: 3, dirty: true });
  expect(store.activeDocument().cur).toBe(15);
  store.actions.disposeDocuments();
});
test('activate, reorder, close others and reopen retain tab identity', async () => {
  const closed = vi.fn();
  const store = makeStore({ fetcher, onClose: closed });
  for (const path of ['one.go', 'two.go', 'three.go']) await store.actions.openDocument(path);
  store.actions.activateDocument(0);
  store.actions.moveDocument(0, 2);
  expect(store.activeDocument().path).toBe('one.go');
  const buffer = store.buffers.get('two.go');
  store.actions.closeOthers(2);
  expect(store.state.documents.tabs.map((tab) => tab.path)).toEqual(['one.go']);
  expect(buffer.lines).toHaveLength(0);
  expect(closed).toHaveBeenCalledTimes(2);
  await store.actions.reopenDocument();
  expect(store.activeDocument().path).toBe('three.go');
  store.actions.disposeDocuments();
});
test('history back and forward do not append navigation entries', async () => {
  const store = makeStore({ fetcher });
  await store.actions.openDocument('one.go', { line: 10 });
  await store.actions.openDocument('two.go', { line: 20 });
  await store.actions.historyGo(-1);
  expect(store.activeDocument()).toMatchObject({ path: 'one.go', cur: 10 });
  await store.actions.historyGo(1);
  expect(store.activeDocument().path).toBe('two.go');
  expect(store.state.documents.history).toHaveLength(2);
  store.actions.disposeDocuments();
});
