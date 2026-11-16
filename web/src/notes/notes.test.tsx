import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import type { EditorStore } from '../editor/store.ts';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { Viewport } from '../editor/Viewport.tsx';
import { EditorShortcuts } from '../editor/EditorShortcuts.tsx';
import { ThreadTurn } from '../threads/ThreadTurn.tsx';
import { decodeThread } from '../threads/decode.ts';
import { ExplainOrb } from '../viewers/ExplainOrb.tsx';
import { decodeNotes, type NoteView } from './store.ts';
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
      detail: 'The full block explanation.',
    },
    {
      thread: 't',
      turn: 1,
      index: 2,
      kind: 'symbol',
      path: 'a.go',
      l1: 1,
      l2: 1,
      symbol: 'one',
      summary: 'Explains the symbol',
      text: 'one',
      detail: 'Symbol detail.',
    },
  ],
});
afterEach(() => Reflect.deleteProperty(Range.prototype, 'getClientRects'));
function setup(list: NoteView[] = notes, bubble = true, total = 4) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  const originalRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-note-panel')
      ? new DOMRect(0, 0, 400, 120)
      : originalRect.call(this);
  });
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
        total,
        start: 0,
        lines: Array.from(
          { length: total },
          (_, index) => ['one', 'two', 'three', 'four'][index] || `line ${index + 1}`,
        ),
        exact: true,
      }),
    });
    editor = createEditorStore(app, { threads: { request: async () => ({ notes: list }), post } });
    if (bubble) editor.actions.orbOpen(decodeThread({ id: 't', turns: [{ id: 1 }] }), 1);
    return (
      <EditorProvider value={editor}>
        <Viewport />
        <EditorShortcuts />
        <ExplainOrb />
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

test('all note kinds keep full source width, span the gutter and only highlight on hover', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  for (const name of ['Explains the symbol', 'Explains the call', 'Explains the block'])
    await screen.findByRole('button', { name });
  expect(document.querySelectorAll('[data-note-inline]')).toHaveLength(3);
  expect(document.querySelector('[data-note-margin]')).toBeNull();
  expect(document.getElementById('rows')?.style.width).toBe('100%');
  expect(document.querySelectorAll('[data-note-bar]')).toHaveLength(4);
  const trigger = screen.getByRole('button', { name: 'Explains the block' });
  expect(trigger.querySelector('.truncate')).toBeTruthy();
  expect(trigger.querySelector('[title="AI explanation"]')).toBeTruthy();
  const before = [...editor.offsets()];
  await fireEvent.mouseEnter(required(trigger.closest('[data-note]')));
  trigger.focus();
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  expect([...editor.offsets()]).toEqual(before);
  for (const line of [3, 4])
    expect(
      document
        .querySelector(`[data-l="${line}"] [data-note-bar]`)
        ?.classList.contains('bg-special!'),
    ).toBe(true);
  expect(document.querySelector<HTMLElement>('[data-l="2"]')?.style.opacity).toBe('0.3');
  await fireEvent.mouseLeave(required(trigger.closest('[data-note]')));
  await fireEvent.mouseEnter(required(document.querySelector('[data-l="3"]')));
  expect(editor.notes.hovered()?.index).toBe(1);
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('click and Enter toggle one inline detail, leaving stays open, Escape restores offsets and caret', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  const trigger = await screen.findByRole('button', { name: 'Explains the block' });
  editor.actions.patch({ cur: 3, col: 0 });
  const before = [...editor.offsets()];
  const caret = required(document.getElementById('caret'));
  const original = caret.style.transform;
  await fireEvent.click(trigger);
  const panel = screen.getByRole('region', { name: 'Explanation detail' });
  expect(document.getElementById('rows')?.contains(panel)).toBe(true);
  expect(document.querySelector('[data-popover]')).toBeNull();
  expect(editor.offsets()[3]).toBe((before[3] || 0) + 120);
  expect(caret.style.transform).not.toBe(original);
  await fireEvent.mouseLeave(required(trigger.closest('[data-note]')));
  expect(document.querySelector('[data-note-panel]')).toBeTruthy();
  await fireEvent.click(trigger);
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  expect([...editor.offsets()]).toEqual(before);
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const other = screen.getByRole('button', { name: 'Explains the call' });
  await fireEvent.click(other);
  expect(document.querySelectorAll('[data-note-panel]')).toHaveLength(1);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await fireEvent.keyDown(other, { key: 'Escape' });
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  expect([...editor.offsets()]).toEqual(before);
  expect(caret.style.transform).toBe(original);
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('inline detail is excluded from source caret, selection, copying, find and line navigation', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await fireEvent.click(await screen.findByRole('button', { name: 'Explains the block' }));
  const rows = required(document.getElementById('rows'));
  const dom = createSourceDOM(rows, () => ({ path: 'a.go' }));
  const panel = required(rows.querySelector('[data-note-panel]'));
  expect(dom.toPos(panel, 0)).toBeNull();
  expect(dom.toPos(required(rows.querySelector('[data-control="note-summary"]')), 0)).toBeNull();
  const point = required(dom.toPoint({ line: 2, col: 2 }));
  expect(dom.toPos(...point)).toEqual({ line: 2, col: 2 });
  expect(
    selectedText(
      { line: 1, col: 0 },
      { line: 4, col: 4 },
      (index) => editor.buffer()?.text(index) || '',
    )?.text,
  ).toBe('one\ntwo\nthree\nfour');
  const source = Array.from({ length: 4 }, (_, index) => editor.buffer()?.text(index) || '').join(
    '\n',
  );
  expect(findMatches(source, 'explanation')).toEqual([]);
  const cur = editor.active()?.cur;
  await fireEvent.mouseDown(panel);
  expect(editor.active()?.cur).toBe(cur);
  editor.actions.patch({ cur: 2, col: 0 });
  await fireEvent.keyDown(required(document.getElementById('viewport')), { key: 'ArrowDown' });
  expect(editor.active()?.cur).toBe(3);
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('inline footer keeps checked links, Open thread, Refresh and permanent dismissal', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  const refresh = vi.spyOn(editor.actions, 'explainSelection').mockResolvedValue();
  const open = vi.spyOn(editor.actions, 'openThread').mockResolvedValue();
  await fireEvent.click(await screen.findByRole('button', { name: 'Explains the call' }));
  expect(screen.getByText('outdated')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'a.go:1' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'bad.go:99' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Open thread' }));
  expect(open).toHaveBeenCalledWith('t');
  expect(editor.store.state.explanation.model?.id).toBe('t');
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(refresh).toHaveBeenCalledWith({ path: 'a.go', l1: 2, l2: 2 }, true);
  await fireEvent.click(screen.getByRole('button', { name: 'Dismiss note' }));
  await waitFor(() =>
    expect(fixture.post).toHaveBeenCalledWith('api/explain/notes/dismiss', {
      thread: 't',
      turn: 1,
      index: 0,
    }),
  );
  expect(editor.notes.notes().some((note) => note.index === 0)).toBe(false);
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('only the open bubble thread and turn render notes; closing hides every annotation immediately', async () => {
  const other = { ...required(notes[0]), thread: 'other', summary: 'Other thread' };
  const later = { ...required(notes[0]), turn: 2, summary: 'Later turn' };
  const fixture = setup([...notes, other, later], false);
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  expect(
    document.querySelectorAll('[data-note-inline],[data-note-bar],[data-note-panel]'),
  ).toHaveLength(0);
  editor.actions.orbOpen(decodeThread({ id: 't', turns: [{ id: 1 }, { id: 2 }] }), 1);
  await screen.findByRole('button', { name: 'Explains the block' });
  expect(screen.queryByRole('button', { name: 'Other thread' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Later turn' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Explains the block' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Close explanation' }));
  expect(
    document.querySelectorAll(
      '[data-note-inline],[data-note-bar],[data-note-panel],[data-popover]',
    ),
  ).toHaveLength(0);
  expect(document.querySelector<HTMLElement>('[data-l="1"]')?.style.opacity).toBe('1');
  editor.actions.orbOpen(decodeThread({ id: 't', turns: [{ id: 1 }, { id: 2 }] }), 2);
  await screen.findByRole('button', { name: 'Later turn' });
  expect(document.querySelectorAll('[data-note-inline]')).toHaveLength(1);
  expect(
    editor.palette.commands.list().some((command) => command.name === 'Explain: Toggle Notes'),
  ).toBe(false);
  expect(localStorage.getItem('faah.notes')).toBeNull();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('thread turn buttons open the first note file and replace the current bubble', async () => {
  const first = decodeThread({ id: 't', kind: 'explain', turns: [{ id: 1, notes }] });
  const second = decodeThread({
    id: 'other',
    kind: 'explain',
    turns: [{ id: 2, notes: [{ ...required(notes[0]), path: 'b.go' }] }],
  });
  const fixture = setup(
    [...notes, { ...required(notes[0]), path: 'b.go', thread: 'other', turn: 2 }],
    false,
  );
  const editor = fixture.editor;
  const threadView = render(() => (
    <EditorProvider value={editor}>
      <ThreadTurn thread={first} turn={required(first.turns[0])} />
      <ThreadTurn thread={second} turn={required(second.turns[0])} />
    </EditorProvider>
  ));
  const buttons = screen.getAllByRole('button', { name: 'Show on code' });
  await fireEvent.click(required(buttons[0]));
  await screen.findByRole('button', { name: 'Explains the block' });
  expect(editor.active()?.path).toBe('a.go');
  expect(editor.active()?.cur).toBe(2);
  expect(editor.store.state.explanation.model).toMatchObject({ id: 't', turn: 1 });
  await fireEvent.click(required(buttons[1]));
  await waitFor(() => expect(editor.active()?.path).toBe('b.go'));
  expect(editor.store.state.explanation.model).toMatchObject({ id: 'other', turn: 2 });
  await waitFor(() => expect(document.querySelectorAll('[data-note-inline]')).toHaveLength(1));
  expect(screen.queryByRole('button', { name: 'Explains the block' })).toBeNull();
  expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
  threadView.unmount();
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('symbol refresh targets current UTF-16 columns', () => {
  expect(
    refreshTarget(
      { ...required(notes[0]), kind: 'symbol', symbol: 'run' },
      () => '  runner(); run()',
    ),
  ).toEqual({ path: 'a.go', l1: 2, l2: 2, c1: 12, c2: 15, symbol: 'run' });
});

test('large annotated ranges stay virtualized and closing an offscreen bubble releases dimming', async () => {
  const fixture = setup([{ ...required(notes[1]), l2: 2500 }], true, 5000);
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await fireEvent.click(await screen.findByRole('button', { name: 'Explains the block' }));
  const expandedHeight = editor.offsets().at(-1);
  editor.setGeometry({ top: 40000 });
  expect(document.querySelectorAll('.row').length).toBeLessThan(100);
  expect(document.querySelector('[data-note-panel]')).toBeNull();
  expect(editor.offsets().at(-1)).toBe(expandedHeight);
  expect(document.querySelector('[data-note-bar]')).toBeTruthy();
  editor.notes.hoverLine(2000);
  expect(editor.notes.dimmed(1)).toBe(true);
  editor.actions.dismissOrb();
  expect(document.querySelector('[data-note-bar]')).toBeNull();
  expect(editor.notes.dimmed(1)).toBe(false);
  expect(editor.notes.extraHeights()).toEqual({});
  expect(editor.offsets().at(-1)).toBe(5000 * editor.geometry.lineHeight);
  fixture.view.unmount();
  vi.unstubAllGlobals();
});

test('revealing a source line scrolls past its expanded annotation', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.openFile('a.go');
  await fireEvent.click(await screen.findByRole('button', { name: 'Explains the block' }));
  editor.notes.measureDetail(required(editor.notes.expanded()), 1000);
  editor.setGeometry({ height: 200 });
  const scroll = vi.spyOn(required(editor.services.source), 'scrollTo');
  editor.actions.revealLine(3);
  expect(scroll).toHaveBeenCalledWith(
    (editor.offsets()[2] || 0) + editor.notes.heightBefore(3) - 100,
  );
  fixture.view.unmount();
  vi.unstubAllGlobals();
});
