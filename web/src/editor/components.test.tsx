import { required } from '../lib/test-values.ts';
import { record, text } from '../lib/decode.ts';
import type { EditorStore } from './store.ts';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from './store.ts';
import { EditorProvider } from './context.tsx';
import { Viewport } from './Viewport.tsx';
import { EditView } from './EditView.tsx';
import { EditControls } from './EditControls.tsx';
import { FindBar } from './FindBar.tsx';
import { TabStrip } from './TabStrip.tsx';
import { EditorShortcuts } from './EditorShortcuts.tsx';
import { SelectionBar } from './SelectionBar.tsx';

let editor: EditorStore | undefined;
let content = '';
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
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    if (path.endsWith('/raw')) return new Response(content);
    if (path.endsWith('/save'))
      content = text(
        record(JSON.parse(typeof options?.body === 'string' ? options.body : '{}')).content,
      );
    return Response.json({
      ok: true,
      results: [{ path: 'file.js', matches: [{ line: 2 }, { line: 3 }] }],
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
});
function Harness() {
  const store = createAppStore({
    fetcher: async (_, params) => ({
      total: 1000,
      start: record(params).start,
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
  required(editor).actions.setSelection({ text: 'Two words', path: 'file.js', l1: 2, l2: 2 });
  fireEvent.click(screen.getByText('Copy Source'));
  await screen.findByText('Copied');
  expect(required(required(editor).ui.selection).text).toBe('Two words');
  view.unmount();
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
test('source slots are reused across scroll windows and cursor changes', async () => {
  const view = render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  const viewport = required(document.getElementById('viewport'));
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  Object.defineProperty(viewport, 'clientWidth', { value: 800 });
  const row = required(document.querySelector<HTMLElement>('#rows .row'));
  required(editor).actions.move(1);
  await waitFor(() =>
    expect(required(document.querySelector<HTMLElement>('.row.cur')).dataset.l).toBe('2'),
  );
  viewport.scrollTop = 2000;
  fireEvent.scroll(viewport);
  await waitFor(() => expect(+(row.dataset.l || 0)).toBeGreaterThan(1));
  expect(document.querySelector('#rows .row')).toBe(row);
  view.unmount();
  required(editor).actions.disposeDocuments();
});
test('native drag selection keeps its initial caret and synchronizes the selected text', async () => {
  const view = render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  const code = required(document.querySelector<HTMLElement>('#rows [data-l="1"] .c'));
  const node = required(required(code.firstChild).firstChild);
  const selection = required(window.getSelection());
  required(editor).actions.selectRange({ line: 1, col: 0 }, { line: 1, col: 1 });
  // A mouse drag starts with a collapsed native selection before it expands.
  selection.setBaseAndExtent(node, 1, node, 1);
  fireEvent(document, new Event('selectionchange'));
  await waitFor(() => expect(required(editor).ui.selection).toBeNull());
  expect(selection.rangeCount).toBe(1);
  expect(selection.anchorNode).toBe(node);
  expect(selection.anchorOffset).toBe(1);

  selection.setBaseAndExtent(node, 1, node, 5);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.mouseUp(document);
  await waitFor(() => expect(required(editor).ui.selection?.text).toBe('alue'));
  expect(required(editor).active()).toMatchObject({
    cur: 1,
    col: 5,
    selAnchor: { line: 1, col: 1 },
  });
  expect(selection.toString()).toBe('alue');
  selection.setBaseAndExtent(node, 5, node, 1);
  fireEvent(document, new Event('selectionchange'));
  await waitFor(() => expect(required(editor).active()?.selAnchor?.col).toBe(5));
  expect(required(editor).active()).toMatchObject({ cur: 1, col: 1 });
  expect(required(editor).ui.selection?.text).toBe('alue');
  expect(selection.toString()).toBe('alue');
  fireEvent.keyDown(required(document.getElementById('viewport')), { key: 'Escape' });
  expect(required(editor).ui.selection).toBeNull();
  expect(selection.rangeCount).toBe(0);
  view.unmount();
  required(editor).actions.disposeDocuments();
});

test('a collapsed selection outside the source does not clear its selection', async () => {
  const view = render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  required(editor).actions.selectRange({ line: 1, col: 0 }, { line: 1, col: 5 });
  const outside = document.createTextNode('outside source');
  view.container.append(outside);
  const selection = required(window.getSelection());
  selection.setBaseAndExtent(outside, 1, outside, 1);
  fireEvent(document, new Event('selectionchange'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(required(editor).ui.selection?.text).toBe('value');
  expect(selection.rangeCount).toBe(1);
  view.unmount();
  required(editor).actions.disposeDocuments();
});
test('find query, next, previous and case actions update the view', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  required(editor).actions.openFind('value');
  await waitFor(() =>
    expect(required(document.getElementById('find-count')).textContent).toBe('1 / 2'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
  expect(required(editor).ui.activeHit).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
  expect(required(editor).ui.activeHit).toBe(0);
  fireEvent.click(required(document.getElementById('find-case')));
  expect(required(editor).ui.caseSensitive).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
  expect(required(editor).ui.findOpen).toBe(false);
  required(editor).actions.disposeDocuments();
});
test('edit mode changes, saves and cancels without mounting a full-file gutter', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  await required(editor).actions.enterEditMode();
  const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'File contents',
  });
  expect(textarea.value).toBe(content);
  expect(required(document.getElementById('viewport')).inert).toBe(true);
  fireEvent.input(textarea, { target: { value: 'changed\nTwo words\n' } });
  expect(required(required(editor).active()).dirty).toBe(true);
  await required(editor).actions.saveActiveFile();
  expect(content).toBe('changed\nTwo words\n');
  expect(required(required(editor).active()).dirty).toBe(false);
  expect(document.querySelectorAll('#editview-gutter > div > div').length).toBeLessThan(100);
  await required(editor).actions.exitEditMode(true);
  expect(required(required(editor).active()).isEditing).toBe(false);
  expect(textarea.value).toBe('');
  expect(required(document.getElementById('viewport')).inert).toBe(false);
  required(editor).actions.disposeDocuments();
});
test('closing an edited tab releases the native textarea copy', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  await required(editor).actions.enterEditMode();
  const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'File contents' });
  expect(textarea.value).toBe(content);
  required(editor).actions.closeTabs([0]);
  expect(textarea.value).toBe('');
  expect(required(editor).store.buffers.size).toBe(0);
});
test('tab close and close others act on metadata and release buffers', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('one.js');
  await required(editor).actions.openFile('two.js');
  required(editor).actions.moveDocument(0, 1);
  expect(required(editor).store.state.documents.tabs.map((tab) => tab.path)).toEqual([
    'two.js',
    'one.js',
  ]);
  required(editor).actions.closeTabs([0]);
  expect(screen.queryByRole('button', { name: 'two.js' })).toBeNull();
  required(editor).actions.disposeDocuments();
});

test('keyboard selection, Escape, Vim counts and listener disposal work together', async () => {
  const view = render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  const viewport = required(document.getElementById('viewport'));
  viewport.focus();
  fireEvent.keyDown(viewport, { key: 'ArrowRight', shiftKey: true });
  expect(required(required(editor).ui.selection).text).toBe('v');
  expect(screen.getByRole('button', { name: /Copy Source/ })).toBeTruthy();
  fireEvent.keyDown(viewport, { key: 'Escape' });
  expect(required(editor).ui.selection).toBeNull();
  expect(required(required(editor).active()).selAnchor).toBeNull();
  required(editor).actions.setVimEnabled(true);
  fireEvent.keyDown(viewport, { key: '3' });
  fireEvent.keyDown(viewport, { key: 'j' });
  expect(required(required(editor).active()).cur).toBe(4);
  fireEvent.keyDown(viewport, { key: 'v' });
  fireEvent.keyDown(viewport, { key: 'w' });
  expect(required(editor).ui.vim.mode).toBe('VISUAL');
  required(editor).actions.setVimEnabled(false);
  expect(required(editor).ui.vim.mode).toBe('NORMAL');
  expect(required(required(editor).active()).selAnchor).toBeNull();
  const line = required(required(editor).active()).cur;
  view.unmount();
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(required(required(editor).active()).cur).toBe(line);
  required(editor).actions.disposeDocuments();
});

test('saving an inactive document cannot clear another document or newer edits', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('one.js');
  await required(editor).actions.enterEditMode();
  fireEvent.input(required(document.querySelector<HTMLTextAreaElement>('#editview-textarea')), {
    target: { value: 'first edit' },
  });
  let finish: ((response: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const save = required(editor).actions.saveActiveFile();
  fireEvent.input(required(document.querySelector<HTMLTextAreaElement>('#editview-textarea')), {
    target: { value: 'newer edit' },
  });
  await required(editor).actions.openFile('two.js');
  required(editor).actions.patch({ dirty: true });
  required(finish)(Response.json({ ok: true }));
  await save;
  expect(required(editor).active()).toMatchObject({ path: 'two.js', dirty: true });
  expect(required(required(editor).store.state.documents.tabs[0]).dirty).toBe(true);
  required(editor).actions.switchTab(0);
  expect(required(document.querySelector<HTMLTextAreaElement>('#editview-textarea')).value).toBe(
    'newer edit',
  );
  required(editor).actions.disposeDocuments();
});

test('a query cancelled by closing find cannot repopulate hits', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  let finish: ((response: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  required(editor).setUI({ query: 'value', findOpen: true });
  const find = required(editor).actions.executeFind();
  required(editor).actions.clearFind();
  required(finish)(Response.json({ results: [{ path: 'file.js', matches: [{ line: 20 }] }] }));
  await find;
  expect(required(editor).ui.hits).toEqual([]);
  expect(required(editor).ui.findOpen).toBe(false);
  required(editor).actions.disposeDocuments();
});

test('backward Vim search starts at the last asynchronously loaded match', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('file.js');
  required(editor).setUI('query', 'value');
  required(editor).actions.setVimEnabled(true);
  fireEvent.keyDown(required(document.getElementById('viewport')), { key: '?' });
  await waitFor(() => expect(required(editor).ui.activeHit).toBe(1));
  expect(required(editor).ui.findOpen).toBe(true);
  required(editor).actions.disposeDocuments();
});

test('covered source rows release their DOM and remount from the existing buffer', async () => {
  render(() => <Harness />);
  await required(editor).actions.openFile('readme.md');
  const buffer = required(editor).buffer();
  expect(document.querySelectorAll('#rows .row')).toHaveLength(0);
  required(editor).actions.setView(required(editor).active(), 'source');
  await waitFor(() => expect(document.querySelector('#rows .c')).toBeTruthy());
  expect(required(editor).buffer()).toBe(buffer);
  required(editor).actions.setView(required(editor).active(), 'markdown');
  expect(document.querySelectorAll('#rows .row')).toHaveLength(0);
  required(editor).actions.disposeDocuments();
});
