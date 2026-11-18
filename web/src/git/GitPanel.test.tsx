import { required } from '../lib/test-values.ts';
import { createEditorStore } from '../editor/store.ts';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createGitStore } from './store.ts';
import { GitPanel } from './GitPanel.tsx';
test('a fresh Git provider submits a typed message and shows server errors', async () => {
  const post = vi.fn().mockRejectedValue(new Error('Commit hook rejected'));
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true });
    app.actions.acceptGitSnapshot({ git: true, statuses: { 'one.js': 'M' } });
    const git = createGitStore(app, { post, request: vi.fn(), openFile: vi.fn() });
    const base = createEditorStore(app);
    const editor = { ...base, git, actions: { ...base.actions, ...git.actions } };
    return (
      <EditorProvider value={editor}>
        <GitPanel />
      </EditorProvider>
    );
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Commit message' }), {
    target: { value: 'Fix file' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Commit hook rejected'),
  );
  expect(required(post.mock.calls[0]).slice(0, 2)).toEqual([
    'api/git/commit',
    { message: 'Fix file' },
  ]);
});

test('Commit looks like an agent action only while the message is empty', () => {
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true });
    app.actions.acceptGitSnapshot({ git: true, statuses: { 'one.js': 'M' } });
    const git = createGitStore(app, { post: vi.fn(), request: vi.fn(), openFile: vi.fn() });
    const base = createEditorStore(app);
    const editor = { ...base, git, actions: { ...base.actions, ...git.actions } };
    return (
      <EditorProvider value={editor}>
        <GitPanel />
      </EditorProvider>
    );
  });
  const commit = screen.getByRole('button', { name: 'Commit' });
  const icon = () => required(commit.querySelector('[data-ui="icon"]'));
  expect(commit.dataset.variant).toBe('special');
  expect(commit.title).toBe('Write a message and commit');
  expect(icon().classList.contains('icon-[ph--spinner]')).toBe(true);
  const message = screen.getByRole('textbox', { name: 'Commit message' });
  fireEvent.input(message, { target: { value: 'Fix file' } });
  expect(commit.dataset.variant).toBe('primary');
  expect(commit.title).toBe('Commit');
  expect(icon().classList.contains('icon-[ph--check]')).toBe(true);
  fireEvent.input(message, { target: { value: '   ' } });
  expect(commit.dataset.variant).toBe('special');
});
