import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { Viewport } from '../editor/Viewport.tsx';
import { EditorShortcuts } from '../editor/EditorShortcuts.tsx';
import { createSourceDOM } from '../editor/source-dom.ts';
import { selectedText } from '../editor/cursor.ts';
import { findMatches } from '../editor/find.ts';
import { decodeFileWindow } from '../editor/decode.ts';
import { record, text } from '../lib/decode.ts';
import { required } from '../lib/test-values.ts';
import { decodeThread, type Walkthrough } from '../threads/decode.ts';
import { ThreadSteps } from '../threads/ThreadSteps.tsx';
import { ThreadTurn } from '../threads/ThreadTurn.tsx';
import { ExplainOrb } from './ExplainOrb.tsx';

const files: Record<string, string[]> = {
  'a.go': ['one', 'two', 'three', 'four'],
  'b.go': ['first', 'second', 'third', 'fourth'],
};
const flow: Walkthrough = {
  title: 'Follow the data',
  steps: [
    {
      path: 'a.go',
      l1: 2,
      l2: 2,
      title: 'Collect input',
      body: 'Read **the input**.',
      text: 'two',
    },
    {
      path: 'a.go',
      l1: 3,
      l2: 4,
      title: 'Parse the input',
      body: 'Parse the value and prepare it.',
      text: 'three\nfour',
    },
    {
      path: 'b.go',
      l1: 2,
      l2: 3,
      title: 'Write the result',
      body: 'Pass it to the writer.',
      text: 'second\nthird',
    },
  ],
};
const note = { path: 'a.go', kind: 'line', l1: 1, l2: 1, summary: 'The earlier note', text: 'one' };
const thread = decodeThread({
  id: 'walk',
  kind: 'explain',
  turns: [
    {
      id: 1,
      tools: ['Read a.go', 'Show notes', 'Show a walkthrough'],
      notes: [note],
      walkthroughs: [flow],
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
});
function setup(sourceFiles = files) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  let editor: EditorStore | undefined;
  const open = vi.fn(async (_endpoint: string, params: unknown) => {
    const path = text(record(params).path);
    const lines = sourceFiles[path];
    if (!lines) throw new Error('file not found');
    const start = Number(record(params).start || 0);
    return {
      total: lines.length,
      start,
      lines: lines.slice(start, start + Number(record(params).count || 1000)),
      exact: true,
    };
  });
  const view = render(() => {
    const app = createAppStore({ fetcher: open });
    editor = createEditorStore(app, {
      threads: {
        request: async () => ({ notes: [{ ...note, thread: 'walk', turn: 1, index: 0 }] }),
      },
    });
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
    view,
    open,
  };
}
async function start(fixture: ReturnType<typeof setup>) {
  await fixture.editor.actions.showExplanation(thread, 1);
  await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(2));
}

test.each([1, 2])('walkthrough counts pluralize %i steps and files', async (count) => {
  const fixture = setup();
  const walkthrough = {
    ...flow,
    steps: [required(flow.steps[0]), required(flow.steps[2])].slice(0, count),
  };
  const counted = decodeThread({
    id: 'counts',
    kind: 'explain',
    turns: [{ id: 1, walkthroughs: [walkthrough] }],
  });
  await fixture.editor.actions.showExplanation(counted, 1);
  expect(screen.getByText(count === 1 ? '1 step · 1 file' : '2 steps · 2 files')).toBeTruthy();
  fixture.editor.actions.setWalkCompact(true);
  expect(screen.getByText(count === 1 ? '1 step' : '2 steps')).toBeTruthy();
  fixture.view.unmount();
});

test('recorded tool steps expose turn actions without toggling their details', async () => {
  const fixture = setup();
  const tools = render(() => (
    <EditorProvider value={fixture.editor}>
      <ThreadSteps thread={thread} turn={required(thread.turns[0])} />
    </EditorProvider>
  ));
  const details = required(
    document.querySelector<HTMLDetailsElement>('details[data-ui="thr-steps"]'),
  );
  details.open = true;
  const list = within(details);
  expect(list.getAllByRole('button')).toHaveLength(2);
  await fireEvent.click(list.getByRole('button', { name: 'Show on code' }));
  expect(details.open).toBe(true);
  expect(fixture.editor.store.state.explanation.model).toMatchObject({ id: 'walk', turn: 1 });
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  await fireEvent.click(list.getByRole('button', { name: 'Open walkthrough' }));
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.title).toBe('Collect input'));
  expect(fixture.editor.store.state.explanation.walk).toEqual({
    index: 0,
    step: 0,
    surface: 'source',
  });
  expect(fixture.editor.active()).toMatchObject({ path: 'a.go', cur: 2 });
  expect(details.open).toBe(true);
  tools.unmount();
  fixture.view.unmount();
});

test('refused calls have no action, and a walkthrough-only running turn opens and starts', async () => {
  const fixture = setup();
  const empty = decodeThread({
    id: 'empty',
    kind: 'explain',
    turns: [{ id: 1, tools: ['Show notes', 'Show a walkthrough'] }],
  });
  const refused = render(() => (
    <EditorProvider value={fixture.editor}>
      <ThreadSteps thread={empty} turn={required(empty.turns[0])} />
    </EditorProvider>
  ));
  expect(refused.container.querySelector('button')).toBeNull();
  refused.unmount();
  const walkOnly = decodeThread({
    id: 'only',
    kind: 'explain',
    turns: [{ id: 2, running: true, tools: ['Show a walkthrough'], walkthroughs: [flow] }],
  });
  const turn = render(() => (
    <EditorProvider value={fixture.editor}>
      <ThreadTurn thread={walkOnly} turn={required(walkOnly.turns[0])} />
    </EditorProvider>
  ));
  await fireEvent.click(turn.getByRole('button', { name: 'Show on code' }));
  expect(fixture.editor.store.state.explanation.model).toMatchObject({
    id: 'only',
    turn: 2,
    phase: 'running',
  });
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  await fixture.editor.actions.showExplanation(walkOnly, 2, { walkthrough: true });
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(2));
  expect(fixture.editor.active()?.path).toBe('a.go');
  turn.unmount();
  fixture.view.unmount();
});

test('the attached widget starts, moves locally, announces steps, and Escape stops before closing', async () => {
  const fixture = setup();
  await fixture.editor.actions.showExplanation(thread, 1);
  const panel = screen.getByRole('region', { name: 'Walkthrough' });
  const card = required(panel.closest('#explain-orb'));
  expect(card.classList.contains('card')).toBe(true);
  expect(card.querySelectorAll('.card')).toHaveLength(0);
  expect(card.querySelector(':scope > header #explain-orb-open')).toBeTruthy();
  expect(card.querySelector(':scope > section')).toBe(panel);
  expect(card.querySelector(':scope > footer')).toBeTruthy();
  expect(within(panel).getByText('3 steps · 2 files')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  await start(fixture);
  expect(within(panel).getByText('the input').tagName).toBe('STRONG');
  expect(within(panel).getByText('1 / 3')).toBeTruthy();
  const progress = within(panel).getByRole('progressbar');
  expect(progress.getAttribute('aria-valuenow')).toBe('1');
  expect(parseFloat(required(progress.firstElementChild as HTMLElement).style.width)).toBeCloseTo(
    100 / 3,
    3,
  );
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true);
  expect(document.activeElement).toBe(panel);
  await fireEvent.keyDown(panel, { key: 'ArrowLeft' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
  await fireEvent.keyDown(panel, { key: 'ArrowRight' });
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(3));
  expect(document.getElementById('explain-orb-live')?.textContent).toBe(
    'Step 2 of 3: Parse the input',
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(fixture.editor.active()?.path).toBe('b.go'));
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  expect(required(progress.firstElementChild as HTMLElement).style.width).toBe('100%');
  await fireEvent.keyDown(panel, { key: 'Escape' });
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  expect(document.getElementById('explain-orb')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  await fireEvent.keyDown(panel, { key: 'Escape' });
  expect(document.getElementById('explain-orb')).toBeNull();
  fixture.view.unmount();
});

test('walkthrough selection switches the active flow and starts at its first step', async () => {
  const fixture = setup();
  const multiple = decodeThread({
    id: 'many',
    kind: 'explain',
    turns: [
      {
        id: 1,
        walkthroughs: [
          flow,
          { title: 'Writer first', steps: [required(flow.steps[2]), required(flow.steps[0])] },
        ],
      },
    ],
  });
  await fixture.editor.actions.showExplanation(multiple, 1);
  await fireEvent.change(screen.getByRole('combobox', { name: 'Choose walkthrough' }), {
    target: { value: '1' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.path).toBe('b.go'));
  expect(fixture.editor.store.state.explanation.walk).toEqual({
    index: 1,
    step: 0,
    surface: 'source',
  });
  await fireEvent.change(screen.getByRole('combobox', { name: 'Choose walkthrough' }), {
    target: { value: '0' },
  });
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.path).toBe('a.go'));
  expect(fixture.editor.store.state.explanation.walk).toEqual({
    index: 0,
    step: 0,
    surface: 'source',
  });
  fixture.view.unmount();
});

test('Done and End keep focus in the card and the location reopens the step range', async () => {
  const fixture = setup();
  await start(fixture);
  const panel = screen.getByRole('region', { name: 'Walkthrough' });
  await fixture.editor.actions.openFile('b.go', { line: 4, view: 'source' });
  expect(fixture.editor.walkthrough.focus()).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'a.go:2-2' }));
  await waitFor(() =>
    expect(fixture.editor.walkthrough.focus()).toMatchObject({ path: 'a.go', l1: 2, l2: 2 }),
  );
  expect(fixture.editor.active()?.cur).toBe(2);
  expect(document.activeElement).toBe(panel);
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  expect(document.activeElement).toBe(panel);
  await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await fireEvent.click(screen.getByRole('button', { name: 'End' }));
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  expect(document.activeElement).toBe(panel);
  fixture.view.unmount();
});

test('section arrows start and move once, while controls and modified arrows are ignored', async () => {
  const fixture = setup();
  const multiple = decodeThread({
    id: 'keys',
    kind: 'explain',
    turns: [{ id: 1, walkthroughs: [flow, { ...flow, title: 'Alternative' }] }],
  });
  await fixture.editor.actions.showExplanation(multiple, 1);
  const panel = screen.getByRole('region', { name: 'Walkthrough' });
  const select = screen.getByRole('combobox');
  const pill = required(document.getElementById('explain-orb-open'));
  const close = screen.getByRole('button', { name: 'Close explanation' });
  for (const target of [pill, close, select]) {
    await fireEvent.keyDown(target, { key: 'ArrowRight' });
    expect(fixture.editor.store.state.explanation.walk).toBeNull();
  }
  await fireEvent.keyDown(panel, { key: 'ArrowLeft' });
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  await fireEvent.keyDown(panel, { key: 'ArrowRight' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(2));
  panel.focus();
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    panel.focus();
    await fireEvent.keyDown(panel, { key: 'ArrowRight', [modifier]: true });
    expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
  }
  for (const target of [pill, close, select]) {
    await fireEvent.keyDown(target, { key: 'ArrowRight' });
    expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
  }
  for (const tag of ['input', 'textarea']) {
    const control = document.createElement(tag);
    panel.append(control);
    await fireEvent.keyDown(control, { key: 'ArrowRight' });
    expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
    control.remove();
  }
  panel.focus();
  await fireEvent.keyDown(panel, { key: 'ArrowRight' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(1);
  fixture.view.unmount();
});

test('focus mode dims only the step file, virtualizes its title, and keeps source operations outside annotations', async () => {
  const fixture = setup();
  const editor = fixture.editor;
  await editor.actions.showExplanation(thread, 1);
  await screen.findByRole('button', { name: 'The earlier note' });
  await start(fixture);
  const rows = required(document.getElementById('rows'));
  const title = required(rows.querySelector<HTMLElement>('[data-walk-title]'));
  expect(title.nextElementSibling?.getAttribute('data-l')).toBe('2');
  expect(title.textContent).toContain('1/3');
  expect(rows.querySelector('[data-note-inline]')).toBeNull();
  expect(rows.querySelector('[data-note-panel]')).toBeNull();
  expect(document.querySelector<HTMLElement>('[data-l="1"]')?.style.opacity).toBe('0.3');
  expect(document.querySelector<HTMLElement>('[data-l="2"]')?.style.opacity).toBe('1');
  expect(document.querySelector('[data-l="2"] [data-note-bar]')).toBeTruthy();
  const dom = createSourceDOM(rows, () => ({ path: 'a.go' }));
  expect(dom.toPos(title, 0)).toBeNull();
  expect(
    selectedText(
      { line: 1, col: 0 },
      { line: 4, col: 4 },
      (index) => editor.buffer()?.text(index) || '',
    )?.text,
  ).toBe('one\ntwo\nthree\nfour');
  expect(findMatches(files['a.go']?.join('\n') || '', 'Collect input')).toEqual([]);
  const viewport = required(document.getElementById('viewport'));
  viewport.focus();
  editor.actions.patch({ cur: 2, col: 0 });
  await fireEvent.keyDown(viewport, { key: 'ArrowRight' });
  expect(editor.active()?.col).toBe(1);
  expect(editor.store.state.explanation.walk?.step).toBe(0);
  await editor.actions.openFile('b.go', { view: 'source' });
  expect(editor.walkthrough.focus()).toBeNull();
  expect(editor.dimmed(1)).toBe(false);
  await editor.actions.openFile('a.go', { view: 'source' });
  expect(editor.walkthrough.focus()?.l1).toBe(2);
  editor.actions.walkStop();
  await screen.findByRole('button', { name: 'The earlier note' });
  expect(document.querySelector('[data-walk-title]')).toBeNull();
  editor.actions.walkStart();
  await waitFor(() => expect(editor.walkthrough.focus()?.l1).toBe(2));
  editor.actions.dismissOrb();
  expect(editor.walkthrough.focus()).toBeNull();
  expect(editor.dimmed(1)).toBe(false);
  fixture.view.unmount();
});

test('changed, past-end and missing step ranges remain visible in the widget without invalid editor focus', async () => {
  const fixture = setup();
  await start(fixture);
  fixture.editor.buffer()?.apply(
    decodeFileWindow({
      total: 4,
      start: 0,
      lines: ['one', 'changed', 'three', 'four'],
      exact: true,
    }),
  );
  expect(screen.getByText('may be outdated')).toBeTruthy();
  const pastEnd = decodeThread({
    id: 'past',
    kind: 'explain',
    turns: [
      {
        id: 1,
        walkthroughs: [
          { title: 'Past the end', steps: [{ ...required(flow.steps[0]), l1: 99, l2: 100 }] },
        ],
      },
    ],
  });
  await fixture.editor.actions.showExplanation(pastEnd, 1, { walkthrough: true });
  await waitFor(() => expect(fixture.editor.walkthrough.focus()).toMatchObject({ l1: 4, l2: 4 }));
  expect(screen.getByText('may be outdated')).toBeTruthy();
  const missing = decodeThread({
    id: 'missing',
    kind: 'explain',
    turns: [
      {
        id: 1,
        walkthroughs: [
          { title: 'Missing source', steps: [{ ...required(flow.steps[0]), path: 'deleted.go' }] },
        ],
      },
    ],
  });
  await fixture.editor.actions.showExplanation(missing, 1, { walkthrough: true });
  await screen.findByText('file not found');
  expect(fixture.editor.walkthrough.focus()).toBeNull();
  expect(fixture.editor.dimmed(1)).toBe(false);
  expect(
    within(screen.getByRole('region', { name: 'Walkthrough' })).getByText('Collect input'),
  ).toBeTruthy();
  fixture.view.unmount();
});

test('walkthrough title rows stay virtualized without changing the offscreen layout height', async () => {
  const lines = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`);
  const fixture = setup({ 'a.go': lines });
  const large = decodeThread({
    id: 'large',
    kind: 'explain',
    turns: [
      {
        id: 1,
        walkthroughs: [
          {
            title: 'Large source',
            steps: [
              {
                ...required(flow.steps[0]),
                l1: 2500,
                l2: 2502,
                text: lines.slice(2499, 2502).join('\n'),
              },
            ],
          },
        ],
      },
    ],
  });
  await fixture.editor.actions.showExplanation(large, 1, { walkthrough: true });
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(2500));
  fixture.editor.setGeometry({ top: 2499 * fixture.editor.geometry.lineHeight - 60, height: 200 });
  expect(document.querySelectorAll('.row').length).toBeLessThan(100);
  expect(document.querySelectorAll('[data-walk-title]')).toHaveLength(1);
  const height = fixture.editor.offsets().at(-1);
  fixture.editor.setGeometry({ top: 0 });
  expect(document.querySelector('[data-walk-title]')).toBeNull();
  expect(fixture.editor.offsets().at(-1)).toBe(height);
  fixture.view.unmount();
});

test('footer arrows advance exactly once from the focused Next button', async () => {
  const fixture = setup();
  await start(fixture);
  const next = screen.getByRole('button', { name: 'Next' });
  next.focus();
  await fireEvent.keyDown(next, { key: 'ArrowRight' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(1);
  fixture.view.unmount();
});

test('compact view keeps toggle focus, hides expanded content, and completes the walk', async () => {
  const fixture = setup();
  const rich = decodeThread({
    ...thread,
    turns: [{ ...thread.turns[0], reply: 'A short conclusion.' }],
  });
  await fixture.editor.actions.showExplanation(rich, 1);
  expect(document.querySelector('[data-orb="done"]')?.classList.contains('shrink-0')).toBe(true);
  expect(document.querySelector('[data-orb="text"]')?.textContent).not.toContain('walkthrough');
  expect(document.getElementById('explain-orb-open')?.getAttribute('aria-label')).toContain(
    '1 walkthrough',
  );
  expect(document.querySelector('[data-orb="snippet"]')).toBeTruthy();
  const toggle = screen.getByRole('button', { name: 'Compact walkthrough' });
  toggle.focus();
  await fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.getItem('faah.walkCompact')).toBe('true');
  expect(document.querySelector('#explain-orb footer')).toBeNull();
  expect(document.querySelector('[data-orb="snippet"]')).toBeNull();
  expect(screen.getByText('3 steps')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(fixture.editor.walkthrough.focus()?.l1).toBe(2));
  expect(screen.queryByText('the input')).toBeNull();
  expect(screen.getByText('1 / 3')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' }).disabled).toBe(true);
  fixture.editor.buffer()?.apply(
    decodeFileWindow({
      total: 4,
      start: 0,
      lines: ['one', 'changed', 'three', 'four'],
      exact: true,
    }),
  );
  expect(screen.getByTitle('may be outdated')).toBeTruthy();
  const panel = screen.getByRole('region', { name: 'Walkthrough' });
  await fireEvent.keyDown(panel, { key: 'ArrowRight' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(1);
  await fireEvent.keyDown(panel, { key: 'ArrowLeft' });
  expect(fixture.editor.store.state.explanation.walk?.step).toBe(0);
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('3 / 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Done' }).title).toBe('Done (→)');
  await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  await fixture.editor.actions.showExplanation(decodeThread({ ...rich, id: 'replacement' }), 1);
  expect(fixture.editor.store.state.explanation.compact).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.keyDown(screen.getByRole('region', { name: 'Walkthrough' }), { key: 'Escape' });
  expect(fixture.editor.store.state.explanation.walk).toBeNull();
  expect(document.getElementById('explain-orb')).toBeTruthy();
  await fireEvent.keyDown(screen.getByRole('region', { name: 'Walkthrough' }), { key: 'Escape' });
  expect(document.getElementById('explain-orb')).toBeNull();
  fixture.view.unmount();
});

test('compact preference loads at startup and tolerates unavailable storage', () => {
  localStorage.setItem('faah.walkCompact', 'true');
  const fixture = setup();
  expect(fixture.editor.store.state.explanation.compact).toBe(true);
  fixture.view.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
    if (key === 'faah.walkCompact') throw new Error('blocked');
    return null;
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const restricted = setup();
  expect(restricted.editor.store.state.explanation.compact).toBe(false);
  expect(() => restricted.editor.actions.setWalkCompact(true)).not.toThrow();
  expect(restricted.editor.store.state.explanation.compact).toBe(true);
  restricted.view.unmount();
});

test('failure status icons cannot shrink beside their text', () => {
  const fixture = setup();
  fixture.editor.actions.orbBegin();
  fixture.editor.actions.orbFailed('Could not explain');
  expect(document.querySelector('[data-orb="fail"]')?.classList.contains('shrink-0')).toBe(true);
  expect(document.querySelector('#explain-orb-compact')).toBeNull();
  fixture.view.unmount();
});
