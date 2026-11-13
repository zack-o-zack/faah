import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, test, vi } from 'vitest';
import { apiText } from '../lib/api.js';
import { copyText } from '../lib/clipboard.js';
import { createSelectionActions } from './selection-actions.js';

vi.mock('../lib/api.js', () => ({ apiText: vi.fn() }));
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true), copyRich: vi.fn() }));

function setup() {
  return createRoot((dispose) => {
    const [ui, setUI] = createStore<{ selection: object | null; menu: object | null }>({
      selection: null,
      menu: null,
    });
    const document = { path: 'main.go', cur: 3, total: 9, diffRef: 'HEAD~1' };
    const model = { text: (index: number) => ['a', 'b', 'third line'][index] };
    const editor = {
      ui,
      setUI,
      active: () => document,
      buffer: () => model,
      services: {},
      handlers: { thread: vi.fn() },
      actions: { patch: vi.fn(), findReferences: vi.fn() },
    };
    return { editor, actions: createSelectionActions(editor), dispose };
  });
}

test('copy actions put the reference, source or agent context on the clipboard', () => {
  const { actions, dispose } = setup();
  const info = { path: 'main.go', l1: 2, l2: 4, text: 'code' };
  expect(actions.runSelectionAction('copy-ref', info)).toBe(true);
  expect(copyText).toHaveBeenLastCalledWith('main.go:2-4');
  actions.runSelectionAction('copy-source', info);
  expect(copyText).toHaveBeenLastCalledWith('code');
  expect(actions.runSelectionAction('unknown', info)).toBe(false);
  dispose();
});

test('a thread without a selection starts from the caret line; usages search the first word', () => {
  const { editor, actions, dispose } = setup();
  expect(actions.runSelectionAction('copy-ref')).toBe(false);
  expect(actions.runSelectionAction('thread')).toBe(true);
  expect(editor.handlers.thread).toHaveBeenCalledWith({
    path: 'main.go',
    l1: 3,
    l2: 3,
    text: 'third line',
  });
  actions.runSelectionAction('usages', { path: 'main.go', l1: 1, l2: 1, text: 'Open file' });
  expect(editor.actions.findReferences).toHaveBeenCalledWith('Open');
  expect(actions.runSelectionAction('explain', { text: 'x'.repeat(12001) })).toBe(false);
  dispose();
});

test('select all reads the file at its diff ref and selects every line', async () => {
  vi.mocked(apiText).mockResolvedValue('one\ntwo');
  const { editor, actions, dispose } = setup();
  await actions.selectAll();
  expect(apiText).toHaveBeenCalledWith('api/raw', { path: 'main.go', ref: 'HEAD~1' });
  expect(editor.ui.selection).toEqual({
    text: 'one\ntwo',
    path: 'main.go',
    l1: 1,
    l2: 9,
    all: true,
  });
  dispose();
});
