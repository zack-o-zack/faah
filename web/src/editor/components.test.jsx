import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from './store.ts';
import { EditorProvider } from './context.tsx';
import { Viewport } from './Viewport.jsx';
import { EditView } from './EditView.jsx';
import { EditControls } from './EditControls.jsx';
import { FindBar } from './FindBar.jsx';
import { TabStrip } from './TabStrip.jsx';
import { EditorShortcuts } from './EditorShortcuts.jsx';
import { SelectionBar } from './SelectionBar.jsx';

let editor;
let content;
beforeEach(() => {
  content = 'one\nTwo words\nthird\n';
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('confirm', () => true);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/raw')) return { ok: true, text: async () => content };
    if (path.endsWith('/save')) content = JSON.parse(options.body).content;
    return {
      json: async () => ({
        ok: true,
        results: [{ path: 'file.js', matches: [{ line: 2 }, { line: 3 }] }],
      }),
    };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete Range.prototype.getClientRects;
});
function Harness() {
  const store = createAppStore({
    fetcher: async (_, params) => ({
      total: 1000,
      start: params.start,
      lines: Array.from({ length: 1000 }, (_, index) => `<span>value ${index + 1}</span>`),
      lang: 'js',
      exact: true,
    }),
  });
  editor = createEditorStore(store);
  return (
    <EditorProvider value={editor}>
      <TabStrip />
      <Viewport />
      <EditView />
      <EditControls />
      <FindBar />
      <SelectionBar />
      <EditorShortcuts />
    </EditorProvider>
  );
}
test('selection copy confirms success on the button without losing the selection', async () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  const view = render(() => <Harness />);
  editor.actions.setSelection({ text: 'Two words', path: 'file.js', l1: 2, l2: 2 });
  fireEvent.click(screen.getByText('Copy Source'));
  await screen.findByText('Copied');
  expect(editor.ui.selection.text).toBe('Two words');
  view.unmount();
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
test('source slots are reused across scroll windows and cursor changes', async () => {
  const view = render(() => <Harness />);
  await editor.actions.openFile('file.js');
  const viewport = document.getElementById('viewport');
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  Object.defineProperty(viewport, 'clientWidth', { value: 800 });
  const row = document.querySelector('#rows .row');
  editor.actions.move(1);
  await waitFor(() => expect(document.querySelector('.row.cur').dataset.l).toBe('2'));
  viewport.scrollTop = 2000;
  fireEvent.scroll(viewport);
  await waitFor(() => expect(+row.dataset.l).toBeGreaterThan(1));
  expect(document.querySelector('#rows .row')).toBe(row);
  view.unmount();
  editor.actions.disposeDocuments();
});
test('find query, next, previous and case actions update the view', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('file.js');
  editor.actions.openFind('value');
  await waitFor(() => expect(document.getElementById('find-count').textContent).toBe('1 / 2'));
  fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
  expect(editor.ui.activeHit).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
  expect(editor.ui.activeHit).toBe(0);
  fireEvent.click(document.getElementById('find-case'));
  expect(editor.ui.caseSensitive).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
  expect(editor.ui.findOpen).toBe(false);
  editor.actions.disposeDocuments();
});
test('edit mode changes, saves and cancels without mounting a full-file gutter', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('file.js');
  await editor.actions.enterEditMode();
  const textarea = await screen.findByRole('textbox', { name: 'File contents' });
  expect(textarea.value).toBe(content);
  expect(document.getElementById('viewport').inert).toBe(true);
  fireEvent.input(textarea, { target: { value: 'changed\nTwo words\n' } });
  expect(editor.active().dirty).toBe(true);
  await editor.actions.saveActiveFile();
  expect(content).toBe('changed\nTwo words\n');
  expect(editor.active().dirty).toBe(false);
  expect(document.querySelectorAll('#editview-gutter > div > div').length).toBeLessThan(100);
  await editor.actions.exitEditMode(true);
  expect(editor.active().isEditing).toBe(false);
  expect(textarea.value).toBe('');
  expect(document.getElementById('viewport').inert).toBe(false);
  editor.actions.disposeDocuments();
});
test('closing an edited tab releases the native textarea copy', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('file.js');
  await editor.actions.enterEditMode();
  const textarea = screen.getByRole('textbox', { name: 'File contents' });
  expect(textarea.value).toBe(content);
  editor.actions.closeTabs([0]);
  expect(textarea.value).toBe('');
  expect(editor.store.buffers.size).toBe(0);
});
test('tab close and close others act on metadata and release buffers', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('one.js');
  await editor.actions.openFile('two.js');
  editor.actions.moveDocument(0, 1);
  expect(editor.store.state.documents.tabs.map((tab) => tab.path)).toEqual(['two.js', 'one.js']);
  editor.actions.closeTabs([0]);
  expect(screen.queryByRole('button', { name: 'two.js' })).toBeNull();
  editor.actions.disposeDocuments();
});

test('keyboard selection, Escape, Vim counts and listener disposal work together', async () => {
  const view = render(() => <Harness />);
  await editor.actions.openFile('file.js');
  const viewport = document.getElementById('viewport');
  viewport.focus();
  fireEvent.keyDown(viewport, { key: 'ArrowRight', shiftKey: true });
  expect(editor.ui.selection.text).toBe('v');
  expect(screen.getByRole('button', { name: /Copy Source/ })).toBeTruthy();
  fireEvent.keyDown(viewport, { key: 'Escape' });
  expect(editor.ui.selection).toBeNull();
  expect(editor.active().selAnchor).toBeNull();
  editor.actions.setVimEnabled(true, false);
  fireEvent.keyDown(viewport, { key: '3' });
  fireEvent.keyDown(viewport, { key: 'j' });
  expect(editor.active().cur).toBe(4);
  fireEvent.keyDown(viewport, { key: 'v' });
  fireEvent.keyDown(viewport, { key: 'w' });
  expect(editor.ui.vim.mode).toBe('VISUAL');
  editor.actions.setVimEnabled(false, false);
  expect(editor.ui.vim.mode).toBe('NORMAL');
  expect(editor.active().selAnchor).toBeNull();
  const line = editor.active().cur;
  view.unmount();
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(editor.active().cur).toBe(line);
  editor.actions.disposeDocuments();
});

test('saving an inactive document cannot clear another document or newer edits', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('one.js');
  await editor.actions.enterEditMode();
  fireEvent.input(document.getElementById('editview-textarea'), {
    target: { value: 'first edit' },
  });
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const save = editor.actions.saveActiveFile();
  fireEvent.input(document.getElementById('editview-textarea'), {
    target: { value: 'newer edit' },
  });
  await editor.actions.openFile('two.js');
  editor.actions.patch({ dirty: true });
  finish({ json: async () => ({ ok: true }) });
  await save;
  expect(editor.active()).toMatchObject({ path: 'two.js', dirty: true });
  expect(editor.store.state.documents.tabs[0].dirty).toBe(true);
  editor.actions.switchTab(0);
  expect(document.getElementById('editview-textarea').value).toBe('newer edit');
  editor.actions.disposeDocuments();
});

test('a query cancelled by closing find cannot repopulate hits', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('file.js');
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  editor.setUI({ query: 'value', findOpen: true });
  const find = editor.actions.executeFind();
  editor.actions.clearFind();
  finish({ json: async () => ({ results: [{ path: 'file.js', matches: [{ line: 20 }] }] }) });
  await find;
  expect(editor.ui.hits).toEqual([]);
  expect(editor.ui.findOpen).toBe(false);
  editor.actions.disposeDocuments();
});

test('backward Vim search starts at the last asynchronously loaded match', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('file.js');
  editor.setUI('query', 'value');
  editor.actions.setVimEnabled(true, false);
  fireEvent.keyDown(document.getElementById('viewport'), { key: '?' });
  await waitFor(() => expect(editor.ui.activeHit).toBe(1));
  expect(editor.ui.findOpen).toBe(true);
  editor.actions.disposeDocuments();
});

test('covered source rows release their DOM and remount from the existing buffer', async () => {
  render(() => <Harness />);
  await editor.actions.openFile('readme.md');
  const buffer = editor.buffer();
  expect(document.querySelectorAll('#rows .row')).toHaveLength(0);
  editor.actions.setView(editor.active(), 'source');
  await waitFor(() => expect(document.querySelector('#rows .c')).toBeTruthy());
  expect(editor.buffer()).toBe(buffer);
  editor.actions.setView(editor.active(), 'markdown');
  expect(document.querySelectorAll('#rows .row')).toHaveLength(0);
  editor.actions.disposeDocuments();
});
