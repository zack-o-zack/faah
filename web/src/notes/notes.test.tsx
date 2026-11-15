import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import type { EditorStore } from '../editor/store.ts';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { Viewport } from '../editor/Viewport.tsx';
import { NoteCard } from './NoteCard.tsx';
import { decodeNotes } from './store.ts';
import { required } from '../lib/test-values.ts';
import { createSourceDOM } from '../editor/source-dom.ts';
import { findMatches } from '../editor/find.ts';
import { refreshTarget } from './targets.ts';
import { selectedText } from '../editor/cursor.ts';
const notes = decodeNotes({
  notes: [
    {
      thread: 't',
      turn: 1,
      index: 0,
      kind: 'line',
      path: 'a.go',
      l1: 2,
      l2: 2,
      summary: 'Explains the call',
      text: 'two',
      detail: 'Calls `a.go:1` and `bad.go:99`',
      links: { 'a.go:1': { line: 1 } },
      stale: 'text',
    },
    {
      thread: 't',
      turn: 1,
      index: 1,
      kind: 'block',
      path: 'a.go',
      l1: 3,
      l2: 4,
      summary: 'Explains the block',
      text: 'three\nfour',
    },
  ],
});
function setup() {
  let editor: EditorStore | undefined;
  const post = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  const view = render(() => {
    const app = createAppStore({
      fetcher: async () => ({
        total: 4,
        start: 0,
        lines: ['one', 'two', 'three', 'four'],
        exact: true,
      }),
    });
    editor = createEditorStore(app, { threads: { request: async () => ({ notes }), post } });
    return (
      <EditorProvider value={editor}>
        <Viewport />
      </EditorProvider>
    );
  });
  return {
    get editor() {
      return required(editor);
    },
    post,
    view,
  };
}
test('ghost summaries stay outside source caret, selection, copy and find', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await screen.findByRole('button', { name: 'Explains the call' });
  const rows = required(document.getElementById('rows'));
  const dom = createSourceDOM(rows, () => ({ path: 'a.go' }));
  const ghost = required(rows.querySelector('[data-note]'));
  expect(dom.toPos(ghost, 0)).toBeNull();
  const point = required(dom.toPoint({ line: 2, col: 2 }));
  expect(dom.toPos(...point)).toEqual({ line: 2, col: 2 });
  expect(
    selectedText(
      { line: 1, col: 0 },
      { line: 3, col: 5 },
      (index) => editor.buffer()?.text(index) || '',
    )?.text,
  ).toBe('one\ntwo\nthree');
  expect(
    findMatches(
      Array.from({ length: 4 }, (_, index) => editor.buffer()?.text(index) || '').join('\n'),
      'Explains',
    ),
  ).toEqual([]);
  expect(rows.querySelectorAll('.c')).toHaveLength(4);
  expect(rows.querySelectorAll('.c')[1]?.textContent).toBe('two');
  const before = editor.active()?.cur;
  await fireEvent.mouseDown(ghost);
  expect(editor.active()?.cur).toBe(before);
  fixture.view.unmount();
  vi.unstubAllGlobals();
});
test('notes dim other lines, narrow to markers, and remember the toggle', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await screen.findByRole('button', { name: 'Explains the call' });
  editor.notes.hoverLine(2);
  expect(document.querySelector<HTMLElement>('[data-l="1"]')?.style.opacity).toBe('0.3');
  expect(document.querySelector<HTMLElement>('[data-l="2"]')?.style.opacity).toBe('1');
  editor.setGeometry({ width: 600 });
  expect(editor.notes.margin()).toBe(24);
  const marker = screen.getByRole('button', { name: 'Explains the block' });
  await fireEvent.mouseEnter(marker.parentElement?.parentElement || marker);
  await screen.findByText('AI explanation');
  editor.notes.toggle();
  expect(localStorage.getItem('faah.notes')).toBe('off');
  expect(editor.notes.notes()).toEqual([]);
  expect(document.querySelector('[data-note-card]')).toBeNull();
  editor.notes.toggle();
  await waitFor(() => expect(editor.notes.notes()).toHaveLength(2));
  fixture.view.unmount();
  vi.unstubAllGlobals();
});
test('outdated details use checked citations, refresh their code and dismiss through the endpoint', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await screen.findByRole('button', { name: 'Explains the call' });
  const refresh = vi.spyOn(editor.actions, 'explainSelection').mockResolvedValue();
  const view = render(() => (
    <EditorProvider value={editor}>
      <NoteCard note={required(notes[0])} />
    </EditorProvider>
  ));
  expect(screen.getByText('outdated')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'a.go:1' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'bad.go:99' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(refresh).toHaveBeenCalledWith({ path: 'a.go', l1: 2, l2: 2, text: 'two' }, true);
  await fireEvent.click(screen.getByRole('button', { name: 'Dismiss note' }));
  await waitFor(() =>
    expect(fixture.post).toHaveBeenCalledWith('api/explain/notes/dismiss', {
      thread: 't',
      turn: 1,
      index: 0,
    }),
  );
  expect(editor.notes.notes().some((n) => n.index === 0)).toBe(false);
  view.unmount();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('symbol refresh targets the current symbol and includes its UTF-16 columns', () => {
  expect(
    refreshTarget(
      { ...required(notes[0]), kind: 'symbol', symbol: 'run' },
      () => '  runner(); run()',
    ),
  ).toEqual({ path: 'a.go', l1: 2, l2: 2, c1: 12, c2: 15, text: 'run' });
});

test('leaving one note does not clear another note hovered during the card grace period', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  const button = await screen.findByRole('button', { name: 'Explains the call' });
  const ghost = required(button.closest('[data-note]'));
  await fireEvent.mouseEnter(ghost);
  await fireEvent.mouseLeave(ghost);
  editor.notes.hoverLine(3);
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(editor.notes.hovered()?.index).toBe(1);
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('reloading notes releases hover owned by the removed ghost', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  const button = await screen.findByRole('button', { name: 'Explains the call' });
  await fireEvent.mouseEnter(required(button.closest('[data-note]')));
  expect(editor.notes.hovered()?.index).toBe(0);
  await editor.notes.refetch();
  expect(editor.notes.hovered()).toBeNull();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});
