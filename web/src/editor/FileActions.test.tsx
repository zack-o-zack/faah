import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { required } from '../lib/test-values.ts';
import { GhostNotes } from '../notes/GhostNotes.tsx';
import { ExplainOrb } from '../viewers/ExplainOrb.tsx';
import { EditorProvider } from './context.tsx';
import { FileActions } from './FileActions.tsx';
import { createEditorStore, type EditorStore } from './store.ts';

function setup() {
  let editor: EditorStore | undefined;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  const post = vi.fn().mockResolvedValue({
    thread: { id: 'whole-file', kind: 'explain', path: 'a.go', turns: [{ id: 1, running: true }] },
  });
  const view = render(() => {
    const app = createAppStore({
      fetcher: async (_endpoint, params) => {
        if (params && typeof params === 'object' && 'path' in params && params.path === 'a.bin')
          throw new Error('binary file');
        return { total: 1000, start: 0, lines: ['package main'], exact: true };
      },
    });
    editor = createEditorStore(app, {
      threads: {
        post,
        request: async () => ({
          notes: [
            {
              thread: 'whole-file',
              turn: 1,
              index: 0,
              path: 'a.go',
              kind: 'line',
              l1: 1,
              l2: 1,
              summary: 'The file entry point',
            },
          ],
        }),
      },
    });
    return (
      <EditorProvider value={editor}>
        <FileActions />
        <ExplainOrb />
        <GhostNotes line={1} />
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
afterEach(() => vi.restoreAllMocks());

test('whole-file explain sits beside edit with matching Basecoat controls', async () => {
  const fixture = setup();
  expect(screen.queryByRole('button', { name: 'Explain this file' })).toBeNull();
  await fixture.editor.actions.openFile('a.go');
  const button = screen.getByRole('button', { name: 'Explain this file' });
  const edit = screen.getByRole('button', { name: 'Edit this file' });
  expect(edit.parentElement?.nextElementSibling).toBe(button);
  expect(button.dataset.variant).toBe(edit.dataset.variant);
  expect(button.dataset.size).toBe(edit.dataset.size);
  expect(button.title).toBe('Explain this file');
  expect(button.querySelector('.text-special.icon-\\[ph--spinner\\]')).toBeTruthy();
  fixture.view.unmount();
});

test('whole-file target enters the existing explain flow, opens its bubble and displays its notes', async () => {
  const fixture = setup();
  await fixture.editor.actions.openFile('a.go');
  await fireEvent.click(screen.getByRole('button', { name: 'Explain this file' }));
  await waitFor(() =>
    expect(fixture.post).toHaveBeenCalledWith(
      'api/explain',
      {
        path: 'a.go',
        file: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  await screen.findByRole('button', { name: 'The file entry point' });
  expect(fixture.editor.store.state.explanation.model).toMatchObject({
    id: 'whole-file',
    turn: 1,
    phase: 'running',
  });
  expect(document.getElementById('explain-orb')).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Explain this file' }).disabled,
  ).toBe(true);
  fixture.editor.actions.dismissOrb();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Explain this file' }).disabled,
  ).toBe(true);
  fixture.editor.actions.acceptThread({
    id: 'whole-file',
    kind: 'explain',
    path: 'a.go',
    turns: [{ id: 1, running: false }],
  });
  expect(screen.getByRole('button', { name: 'Explain this file' })).toBeTruthy();
  fixture.view.unmount();
});

test('whole-file explain hides in Changes, images, previews, editing and historical files', async () => {
  const fixture = setup();
  await fixture.editor.actions.openFile('a.go');
  for (const patch of [
    { diffMode: 'unified' },
    { isImage: true },
    { path: 'a.md', view: 'markdown' },
    { path: 'a.csv', view: 'table' },
    { isEditing: true },
    { deleted: true },
    { diffRef: 'abc123' },
  ]) {
    fixture.editor.actions.patch(patch);
    expect(screen.queryByRole('button', { name: 'Explain this file' })).toBeNull();
    fixture.editor.actions.patch({
      path: 'a.go',
      view: 'source',
      isImage: false,
      diffMode: null,
      isEditing: false,
      deleted: false,
      diffRef: '',
    });
  }
  fixture.editor.actions.acceptThread({
    id: 'another-file',
    kind: 'explain',
    path: 'b.go',
    turns: [{ id: 1, running: true }],
  });
  expect(screen.getByRole('button', { name: 'Explain this file' })).toBeTruthy();
  fixture.view.unmount();
});

test('unsupported binary files never expose the explain action', async () => {
  const fixture = setup();
  await fixture.editor.actions.openFile('a.bin');
  expect(fixture.editor.active()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Explain this file' })).toBeNull();
  fixture.view.unmount();
});

test('file view rails retain hooks, activate with arrows and rove the keyboard stop', async () => {
  const fixture = setup();
  await fixture.editor.actions.openFile('a.go');
  fixture.editor.store.actions.setWorkspace({ git: true, gitFiles: ['a.go'] });
  fixture.editor.actions.patch({ diffAvailable: true });
  const file = screen.getByRole<HTMLButtonElement>('tab', { name: 'File' });
  const changes = screen.getByRole<HTMLButtonElement>('tab', { name: 'Changes' });
  expect(file.id).toBe('diff-source');
  expect(changes.id).toBe('diff-btn');
  expect(file.getAttribute('aria-controls')).toBe('editor');
  expect(file.getAttribute('aria-selected')).toBe('true');
  expect(file.tabIndex).toBe(0);
  file.focus();
  fireEvent.keyDown(file, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(changes);
  expect(changes.getAttribute('aria-selected')).toBe('true');
  expect(file.tabIndex).toBe(-1);
  fireEvent.keyDown(changes, { key: 'Home' });
  expect(file.getAttribute('aria-selected')).toBe('true');
  fixture.editor.actions.patch({ path: 'a.md', view: 'source', lang: 'Markdown' });
  const preview = screen.getByRole<HTMLButtonElement>('tab', { name: 'Preview' });
  const source = screen.getByRole<HTMLButtonElement>('tab', { name: 'Source' });
  expect(preview.dataset.md).toBe('preview');
  expect(source.dataset.md).toBe('source');
  fireEvent.click(preview);
  expect(preview.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(preview, { key: 'End' });
  expect(document.activeElement).toBe(source);
  expect(source.getAttribute('aria-selected')).toBe('true');
  fixture.view.unmount();
});
