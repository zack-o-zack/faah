import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { prMeta } from '../pr/test-editor.ts';
import { decodeThread, type Thread } from './decode.ts';
import { ThreadArtifacts } from './ThreadArtifacts.tsx';

const thread = decodeThread({
  id: 'explain',
  kind: 'explain',
  turns: [
    {
      id: 1,
      notes: [
        { path: 'internal/probe.go', l1: 23, l2: 25, summary: 'Cache the result' },
        { path: 'internal/git.go', l1: 34, l2: 34, summary: 'Probe the repository' },
        { path: 'internal/probe.go', l1: 13, l2: 13, summary: 'Check the switch' },
      ],
      walkthroughs: [
        {
          title: 'Git probe',
          steps: [
            {
              path: 'internal/probe.go',
              l1: 13,
              l2: 13,
              title: 'Check the switch',
              body: 'Exit if git is off.',
            },
            {
              path: 'internal/probe.go',
              l1: 23,
              l2: 25,
              title: 'Check the cache',
              body: 'Use the saved result.',
            },
          ],
        },
        {
          title: 'Run git',
          steps: [
            {
              path: 'internal/git.go',
              l1: 34,
              l2: 34,
              title: 'Probe the repository',
              body: 'Run the git probe.',
            },
          ],
        },
      ],
    },
  ],
});
function setup(value: Thread = thread) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  const [current, setThread] = createSignal(value);
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore({
      fetcher: async () => ({
        start: 0,
        total: 50,
        exact: true,
        lines: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`),
      }),
    });
    editor = createEditorStore(app, { threads: { request: async () => ({ notes: [] }) } });
    return (
      <EditorProvider value={editor}>
        <ThreadArtifacts thread={current()} turn={required(current().turns[0])} />
      </EditorProvider>
    );
  });
  return { editor: required(editor), setThread };
}

test('the turn card renders its title, numbered walkthroughs and one chip per file', () => {
  setup();
  expect(screen.getByText('Walkthrough · Git probe')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Run git' })).toBeTruthy();
  const steps = within(screen.getByRole('list', { name: 'Git probe' }));
  expect(steps.getAllByRole('listitem')).toHaveLength(2);
  const second = steps.getByRole('button', { name: 'Check the cache :23' });
  expect(second.title).toBe('Use the saved result.');
  expect(second.textContent).toContain('2');
  expect(screen.queryByText('Use the saved result.')).toBeNull();
  expect(screen.getByRole('button', { name: 'probe.go 2 notes' }).title).toBe('internal/probe.go');
  expect(screen.getByRole('button', { name: 'git.go 1 note' }).title).toBe('internal/git.go');
  expect(screen.getAllByRole('switch', { name: 'Show in editor' })).toHaveLength(1);
  expect(document.querySelectorAll('[data-ui="thr-artifacts"]')).toHaveLength(1);
});

test('notes alone use the notes title, and empty finished turns have no card', () => {
  const { setThread } = setup(
    decodeThread({ id: 'notes', turns: [{ id: 1, notes: thread.turns[0]?.notes }] }),
  );
  expect(screen.getByText('Notes on the code')).toBeTruthy();
  expect(screen.queryByRole('list')).toBeNull();
  setThread(decodeThread({ id: 'empty', turns: [{ id: 1 }] }));
  expect(screen.queryByRole('region')).toBeNull();
});

test('running turns show a thinking spiral and live note count without a switch', () => {
  const { setThread } = setup(
    decodeThread({ id: 'running', kind: 'explain', turns: [{ id: 1, running: true }] }),
  );
  expect(screen.getByRole('status').textContent).toBe('0 notes so far');
  const spiral = required(document.querySelector<SVGElement>('[data-state="thinking"]'));
  expect(spiral.style.width).toBe('18px');
  expect(screen.queryByRole('switch')).toBeNull();
  setThread(decodeThread({ ...thread, turns: [{ ...thread.turns[0], running: true }] }));
  expect(screen.getByRole('status').textContent).toBe('3 notes so far');
  expect(screen.queryByRole('switch')).toBeNull();
  setThread(thread);
  expect(screen.getByRole('switch')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

test('agent threads show the card only once a turn has notes or a walkthrough', async () => {
  const agent = decodeThread({ ...thread, id: 'agent', kind: '' });
  const { editor, setThread } = setup(
    decodeThread({ id: 'agent', turns: [{ id: 1, running: true }] }),
  );
  expect(document.querySelector('[data-ui="thr-artifacts"]')).toBeNull();
  setThread(agent);
  expect(screen.getByText('Walkthrough · Git probe')).toBeTruthy();
  const show = vi.spyOn(editor.actions, 'showExplanation');
  await userEvent.setup().click(screen.getByRole('switch', { name: 'Show in editor' }));
  expect(show).toHaveBeenCalledWith(agent, 1);
});

test('the switch derives both IDs from the editor and supports keyboard show and dismiss', async () => {
  const { editor } = setup();
  const user = userEvent.setup();
  const show = vi.spyOn(editor.actions, 'showExplanation');
  const dismiss = vi.spyOn(editor.actions, 'dismissOrb');
  const toggle = screen.getByRole<HTMLInputElement>('switch', { name: 'Show in editor' });
  expect(toggle.checked).toBe(false);
  editor.actions.orbOpen(thread, 1);
  expect(toggle.checked).toBe(true);
  editor.actions.orbOpen({ ...thread, id: 'another' }, 1);
  expect(toggle.checked).toBe(false);
  editor.actions.orbOpen(decodeThread({ id: thread.id, turns: [{ id: 2 }] }), 2);
  expect(toggle.checked).toBe(false);
  toggle.focus();
  await user.keyboard(' ');
  expect(show).toHaveBeenCalledWith(thread, 1);
  expect(toggle.checked).toBe(true);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await user.keyboard(' ');
  expect(dismiss).toHaveBeenCalledOnce();
  expect(toggle.checked).toBe(false);
  editor.actions.orbOpen(thread, 1);
  editor.actions.dismissOrb();
  expect(toggle.checked).toBe(false);
});

test('step 2 opens its turn at position 1, focuses the editor and tracks external navigation', async () => {
  const { editor } = setup();
  const focus = vi.fn();
  editor.services.walkthrough = { focus };
  const second = screen.getByRole('button', { name: 'Check the cache :23' });
  expect(second.getAttribute('aria-current')).toBeNull();
  await fireEvent.click(second);
  expect(editor.store.state.explanation.model).toMatchObject({ id: thread.id, turn: 1 });
  expect(editor.store.state.explanation.walk).toEqual({ index: 0, step: 1, surface: 'source' });
  expect(second.getAttribute('aria-current')).toBe('step');
  expect(focus).toHaveBeenCalledOnce();
  await waitFor(() => expect(editor.active()?.cur).toBe(23));
  editor.actions.walkMove(-1);
  expect(second.getAttribute('aria-current')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Check the switch :13' }).getAttribute('aria-current'),
  ).toBe('step');
  await fireEvent.click(screen.getByRole('button', { name: 'Probe the repository :34' }));
  expect(editor.store.state.explanation.walk).toEqual({ index: 1, step: 0, surface: 'source' });
  expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  editor.actions.dismissOrb();
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
});

test('a note chip shows its turn and opens the earliest note line in source view', async () => {
  const { editor } = setup();
  const open = vi.spyOn(editor.actions, 'showExplanation');
  await fireEvent.click(screen.getByRole('button', { name: 'probe.go 2 notes' }));
  expect(open).toHaveBeenCalledWith(thread, 1, {
    note: { path: 'internal/probe.go', l1: 13, count: 2 },
  });
  await waitFor(() =>
    expect(editor.active()).toMatchObject({ path: 'internal/probe.go', cur: 13, view: 'source' }),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'git.go 1 note' }));
  await waitFor(() =>
    expect(editor.active()).toMatchObject({ path: 'internal/git.go', cur: 34, view: 'source' }),
  );
  expect(editor.store.state.explanation.model).toMatchObject({ id: thread.id, turn: 1 });
  expect(editor.store.state.explanation.walk).toBeNull();
});

test('a note chip reuses the review reveal path without opening a source tab', async () => {
  const { editor } = setup();
  editor.store.actions.setWorkspace({ name: 'repo', pr: prMeta() });
  editor.actions.setReviewMode('review');
  const reveal = vi.spyOn(editor.review.actions, 'revealWalkthrough');
  await fireEvent.click(screen.getByRole('button', { name: 'git.go 1 note' }));
  expect(reveal).toHaveBeenCalledWith('internal/git.go', 34);
  expect(editor.review.state.mode).toBe('review');
  expect(editor.review.state.tab).toBe('walkthrough');
  expect(editor.review.state.filter).toBe('all');
  expect(editor.active()).toBeNull();
});
