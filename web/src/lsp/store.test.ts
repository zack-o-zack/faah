import { record, text } from '../lib/decode.ts';
import type { Request } from '../lib/api.ts';
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createLanguageStore } from './store.ts';
import { callIdentity, callTarget, isCallCycle, canAskServer, positionNow } from './logic.ts';
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request: Request) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const app = createAppStore();
    const document = { path: 'one.js', cur: 1, total: 10, lsp: { state: 'off' } };
    const editor = {
      store: app,
      active: () => document,
      actions: {
        ...app.actions,
        wordAtCaret: () => ({ path: 'one.js', word: 'value', line: 1, col: 6 }),
        setSearchResults: vi.fn(),
        searchWorkspace: vi.fn(),
        openFile: vi.fn(),
        centerLine: vi.fn(),
      },
    };
    const post = vi.fn(async () => ({ state: 'ready', server: 'ts' }));
    const language = createLanguageStore(editor, { request, post });
    return { app, editor, language, post };
  });
}
test('position precision and call recursion/site targets are pure', () => {
  const node = { path: 'a', line: 2, name: 'fn', sitePath: 'b', sites: [8] };
  expect(callTarget(node, 'in')).toEqual({ path: 'b', line: 8 });
  expect(callTarget(node, 'out')).toEqual({ path: 'a', line: 2 });
  expect(isCallCycle(node, [callIdentity(node)])).toBe(true);
  const at = positionNow({ path: 'a', cur: 2 }, {}, 'fn');
  expect(canAskServer(at, 'ready')).toBe(false);
});
test('definition requests use the measured position and preserve navigation history', async () => {
  const request = vi.fn(async () => ({ hits: [{ path: 'two.js', line: 7 }], server: 'ts' }));
  const { app, editor, language } = fixture(request);
  app.actions.patchLsp('state', 'ready');
  await language.actions.gotoDefinition(
    { path: 'one.js', word: 'value', line: 1, col: 6 },
    { view: 'source' },
  );
  expect(request.mock.calls[0]?.slice(0, 2)).toEqual([
    'api/lsp/def',
    { path: 'one.js', line: 1, col: 6, wait: 5000 },
  ]);
  expect(editor.actions.openFile).toHaveBeenCalledWith('two.js', {
    line: 7,
    view: 'source',
    soft: false,
  });
  expect(app.state.documents.history[0]?.path).toBe('one.js');
});
test('stale references cannot replace a newer target', async () => {
  let finish: () => void = () => {
    throw new Error('Missing request');
  };
  const request = vi.fn(async (_path: string, params: unknown) => {
    const query = text(record(params).q);
    if (query === 'old')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { header: query, results: [] };
  });
  const { language } = fixture(request);
  language.actions.findReferences({ word: 'old', imprecise: true });
  language.actions.findReferences({ word: 'new', imprecise: true });
  await vi.waitFor(() => expect(language.references()?.header).toBe('new'));
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(language.references()?.header).toBe('new');
});
test('LSP actions expose pending/errors and refresh the shared server resource', async () => {
  const { app, language, post } = fixture(vi.fn(async () => ({ servers: [], anyRunning: false })));
  await language.actions.startAllLsp();
  expect(post).toHaveBeenCalledWith(
    'api/lsp/start',
    { server: 'all' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(language.state.pending).toBe('');
  language.actions.showCalls({ word: 'value', line: 1, col: 6 });
  expect(app.state.layout.inspector).toBe('calls');
});
