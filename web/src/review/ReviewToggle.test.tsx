import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { AppShell } from '../app/AppShell.tsx';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { isMac } from '../lib/keyboard.ts';
import { required } from '../lib/test-values.ts';
import { prMeta } from '../pr/test-editor.ts';

afterEach(() => vi.unstubAllGlobals());

function mount(git = true, changed = false) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git, gitChanges: changed ? 1 : 0 });
    app.actions.acceptGitSnapshot({ git, statuses: changed ? { 'one.js': 'M' } : {} });
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    editor = createEditorStore(app, {
      review: { request: async () => ({ config: { stages: [] }, files: [] }) },
    });
    return (
      <EditorProvider value={editor}>
        <AppShell />
      </EditorProvider>
    );
  });
  return required(editor);
}

const topBar = () => required(document.getElementById('main-top-bar'));
const pressReviewShortcut = () =>
  fireEvent.keyDown(document, {
    key: 'V',
    shiftKey: true,
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
  });

test.each([
  [false, false],
  [true, false],
  [true, true],
])('local workflows have no Review section (git=%s, changed=%s)', (git, changed) => {
  const editor = mount(git, changed);
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(document.getElementById('btn-review')).toBeNull();
  expect(document.getElementById('btn-pr-toggle')).toBeNull();
  pressReviewShortcut();
  expect(editor.review.state.mode).toBe('code');
  expect(document.getElementById('review-view')).toBeNull();
  expect(
    editor.shortcuts.entries().filter((entry) => entry.keys.includes('Mod+Shift+V')),
  ).toHaveLength(0);
});

test('local workflows cannot enter Review through actions or the shortcut', () => {
  const editor = mount();
  editor.actions.setReviewMode('review');
  expect(editor.review.state.mode).toBe('code');
  editor.actions.toggleReviewMode();
  expect(editor.review.state.mode).toBe('code');
  const event = new KeyboardEvent('keydown', {
    key: 'V',
    shiftKey: true,
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(editor.review.state.mode).toBe('code');
});

test('only a PR exposes Review, and losing PR context closes it and removes its shortcut', () => {
  const editor = mount();
  editor.store.actions.setWorkspace({ git: true, pr: prMeta() });
  expect(topBar().querySelector('#btn-pr-toggle')?.textContent).toContain('PR #7');
  expect(
    editor.shortcuts.entries().filter((entry) => entry.keys.includes('Mod+Shift+V')),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'PR #7' }));
  expect(editor.review.state.mode).toBe('review');
  expect(topBar().querySelector('#btn-pr-close')).toBeTruthy();
  pressReviewShortcut();
  expect(editor.review.state.mode).toBe('code');
  pressReviewShortcut();
  expect(editor.review.state.mode).toBe('review');
  editor.store.actions.setWorkspace({ git: true, gitChanges: 1 });
  expect(editor.review.state.mode).toBe('code');
  expect(document.getElementById('review-view')).toBeNull();
  expect(topBar().querySelector('#btn-pr-close')).toBeNull();
  expect(
    editor.shortcuts.entries().filter((entry) => entry.keys.includes('Mod+Shift+V')),
  ).toHaveLength(0);
});
