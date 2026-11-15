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

const reviewButton = () => required(document.querySelector<HTMLButtonElement>('#side #btn-review'));
const topBar = () => required(document.getElementById('main-top-bar'));

test.each([false, true])(
  'Review sits below the Git panel in Diff mode (changed=%s)',
  async (changed) => {
    const editor = mount(true, changed);
    const diff = screen.getByRole('button', { name: 'Diff' });
    expect(diff.hasAttribute('disabled')).toBe(false);
    fireEvent.click(diff);
    const button = reviewButton();
    expect(button.textContent).toBe('Review');
    expect(button.dataset.variant).toBe('outline');
    expect(button.dataset.size).toBe('sm');
    expect(button.title).toContain('Changed files, review pipeline and PR comments');
    expect(button.querySelector('.icon-\\[lucide--list-checks\\]')).toBeTruthy();
    expect(topBar().querySelector('#btn-pr-toggle')).toBeNull();
    expect(topBar().querySelector('#btn-review')).toBeNull();
    const recent = required(document.getElementById('git-recent-commits'));
    expect(recent.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.closest('#git-panel-body')).toBeNull();
    fireEvent.click(button);
    expect(editor.review.state.mode).toBe('review');
    expect(document.getElementById('btn-review')).toBeNull();
    expect(topBar().querySelector('#btn-pr-close')?.textContent).toContain('Back to editor');
    fireEvent.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect(editor.review.state.mode).toBe('code');
    expect(reviewButton()).toBeTruthy();
  },
);

test('a PR keeps its entry in the top bar and hides the sidebar entry', () => {
  const editor = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(reviewButton()).toBeTruthy();
  editor.store.actions.setWorkspace({ git: true, pr: prMeta() });
  expect(document.getElementById('btn-review')).toBeNull();
  expect(topBar().querySelector('#btn-pr-toggle')?.textContent).toContain('PR #7');
  fireEvent.click(screen.getByRole('button', { name: 'PR #7' }));
  expect(editor.review.state.mode).toBe('review');
  expect(topBar().querySelector('#btn-pr-toggle')).toBeNull();
  expect(topBar().querySelector('#btn-pr-close')).toBeTruthy();
});

test('Files hides Review while its shortcut and single help entry remain active', () => {
  const editor = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(reviewButton()).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  expect(document.getElementById('btn-review')).toBeNull();
  expect(document.getElementById('btn-pr-toggle')).toBeNull();
  const help = () =>
    editor.shortcuts.entries().filter((entry) => entry.keys.includes('Mod+Shift+V'));
  expect(help()).toHaveLength(1);
  expect(help()[0]?.label).toBe('Toggle review');
  const key = () =>
    fireEvent.keyDown(document, {
      key: 'V',
      shiftKey: true,
      ...(isMac ? { metaKey: true } : { ctrlKey: true }),
    });
  key();
  expect(editor.review.state.mode).toBe('review');
  key();
  expect(editor.review.state.mode).toBe('code');
  expect(document.getElementById('btn-review')).toBeNull();
  expect(help()).toHaveLength(1);
});

test('non-Git Diff mode shows Review without a Git panel', () => {
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(document.getElementById('git-panel')).toBeNull();
  expect(reviewButton()).toBeTruthy();
  expect(topBar().querySelector('#btn-pr-toggle')).toBeNull();
});
