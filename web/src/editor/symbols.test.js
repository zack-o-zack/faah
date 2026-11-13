import { createRoot } from 'solid-js';
import { test, expect, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createSymbolActions } from './symbols.js';
const options = { fetcher: async () => ({ lines: ['source'], total: 1, exact: true }) };

test('symbol actions deduplicate requests and store server results as metadata', async () => {
  const store = createRoot(() => createAppStore(options));
  await store.actions.openDocument('file.js');
  const request = vi.fn().mockResolvedValue({ symbols: [{ name: 'value', line: 1 }] });
  const actions = createSymbolActions(store, { request });
  await Promise.all([actions.load('file.js'), actions.load('file.js')]);
  expect(request).toHaveBeenCalledOnce();
  expect(store.activeDocument().outline[0].name).toBe('value');
  actions.dispose();
  store.actions.disposeDocuments();
});
test('closing and reopening a path cannot accept an old symbol response', async () => {
  const store = createRoot(() => createAppStore(options));
  await store.actions.openDocument('file.js');
  let finish;
  let signal;
  const actions = createSymbolActions(store, {
    request: (_, params, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = actions.load('file.js');
  actions.cancel('file.js');
  expect(signal.aborted).toBe(true);
  store.actions.closeDocument(0);
  await store.actions.openDocument('file.js');
  finish({ symbols: [{ name: 'stale' }] });
  await pending;
  expect(store.activeDocument().outline).toBeNull();
  actions.dispose();
  store.actions.disposeDocuments();
});
