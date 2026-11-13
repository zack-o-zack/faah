import type { RequestOptions } from '../lib/api.ts';
import type { AppOptions } from '../app/store.ts';
import { record, number } from '../lib/decode.ts';
import { createRoot } from 'solid-js';
import { afterEach, test, expect, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const makeStore = (options: AppOptions) =>
  createRoot((dispose) => {
    disposers.push(dispose);
    return createAppStore(options);
  });
const fetcher = async (_path: string, params?: unknown, _options?: RequestOptions) => ({
  start: number(record(params).start),
  total: 50000,
  lang: 'go',
  lines: ['<b>one</b>'],
  exact: true,
});

test('document metadata is reactive while buffers stay outside the store', async () => {
  const store = makeStore({ fetcher });
  await store.actions.openDocument('one.go');
  expect(store.state.documents.tabs[0]).toMatchObject({ path: 'one.go', cur: 1, total: 50000 });
  expect(store.state.documents.tabs[0] && 'lines' in store.state.documents.tabs[0]).toBe(false);
  expect(store.buffers.get('one.go')?.lines).toHaveLength(50000);
  store.actions.patchDocument('one.go', { cur: 15, col: 3, dirty: true });
  expect(store.activeDocument()?.cur).toBe(15);
  store.actions.disposeDocuments();
});
test('activate, reorder, close others and reopen retain tab identity', async () => {
  const closed = vi.fn();
  const store = makeStore({ fetcher, onClose: closed });
  for (const path of ['one.go', 'two.go', 'three.go']) await store.actions.openDocument(path);
  store.actions.activateDocument(0);
  store.actions.moveDocument(0, 2);
  expect(store.activeDocument()?.path).toBe('one.go');
  const buffer = store.buffers.get('two.go');
  store.actions.closeOthers(2);
  expect(store.state.documents.tabs.map((tab) => tab.path)).toEqual(['one.go']);
  expect(buffer?.lines).toHaveLength(0);
  expect(closed).toHaveBeenCalledTimes(2);
  await store.actions.reopenDocument();
  expect(store.activeDocument()?.path).toBe('three.go');
  store.actions.disposeDocuments();
});
test('history back and forward do not append navigation entries', async () => {
  const store = makeStore({ fetcher });
  await store.actions.openDocument('one.go', { line: 10 });
  await store.actions.openDocument('two.go', { line: 20 });
  await store.actions.historyGo(-1);
  expect(store.activeDocument()).toMatchObject({ path: 'one.go', cur: 10 });
  await store.actions.historyGo(1);
  expect(store.activeDocument()?.path).toBe('two.go');
  expect(store.state.documents.history).toHaveLength(2);
  store.actions.disposeDocuments();
});

test('opening another revision resets diff metadata and disposes old buffers', async () => {
  const store = makeStore({
    fetcher: async (...args) => ({
      ...(await fetcher(...args)),
      diffAvailable: true,
    }),
  });
  await store.actions.openDocument('one.go', { ref: 'old', base: 'parent', layout: 'unified' });
  const old = store.buffers.get('one.go');
  expect(store.activeDocument()?.diffMode).toBe('unified');
  await store.actions.openDocument('one.go', { ref: 'new', base: 'other', view: 'source' });
  expect(old?.lines).toHaveLength(0);
  expect(store.buffers.get('one.go')).not.toBe(old);
  expect(store.activeDocument()).toMatchObject({
    diffRef: 'new',
    diffBase: 'other',
    diffMode: null,
  });
  store.actions.patchDocument('one.go', { isEditing: true });
  await store.actions.openDocument('one.go', { ref: 'new', base: 'other', view: 'diff' });
  expect(store.activeDocument()).toMatchObject({ isEditing: false, diffMode: 'split' });
  store.actions.disposeDocuments();
});

test('concurrent opens of the same file share one request and one tab', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const request = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        finish = resolve;
      }),
  );
  const store = makeStore({ fetcher: request });
  const first = store.actions.openDocument('one.go');
  const second = store.actions.openDocument('one.go', { line: 15 });
  if (!finish) throw new Error('Request did not start');
  finish(await fetcher('api/file', {}));
  await Promise.all([first, second]);
  expect(request).toHaveBeenCalledOnce();
  expect(store.state.documents.tabs).toHaveLength(1);
  expect(store.activeDocument()?.cur).toBe(15);
  store.actions.disposeDocuments();
});
