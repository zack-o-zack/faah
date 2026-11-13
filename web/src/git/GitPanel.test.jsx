import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.jsx';
import { createGitStore } from './store.ts';
import { GitPanel } from './GitPanel.jsx';
test('a fresh Git provider submits a typed message and shows server errors', async () => {
  const post = vi.fn().mockRejectedValue(new Error('Commit hook rejected'));
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true });
    app.actions.acceptGitSnapshot({ git: true, statuses: { 'one.js': 'M' } });
    const git = createGitStore(app, { post, request: vi.fn(), openFile: vi.fn() });
    const editor = {
      store: app,
      git,
      agents: { state: { selected: '', harnesses: [] } },
      actions: git.actions,
      active: () => null,
    };
    return (
      <EditorProvider value={editor}>
        <GitPanel />
      </EditorProvider>
    );
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Commit message' }), {
    target: { value: 'Fix file' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Commit', exact: true }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Commit hook rejected'),
  );
  expect(post.mock.calls[0].slice(0, 2)).toEqual(['api/git/commit', { message: 'Fix file' }]);
});
