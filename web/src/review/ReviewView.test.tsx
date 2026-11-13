import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import type { EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { ReviewView } from './ReviewView.tsx';

function mount(reply: unknown, walkthrough: unknown = { files: [], totalFiles: 0 }) {
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore();
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    const request = vi.fn(async (path: string) =>
      path.includes('walkthrough') ? walkthrough : reply,
    );
    editor = createEditorStore(app, { review: { request } });
    return (
      <EditorProvider value={editor}>
        <ReviewView />
      </EditorProvider>
    );
  });
  return required(editor);
}

test('the overview mounts only in review mode and toggles its layout', async () => {
  const editor = mount({ config: { stages: [{ id: 'a', title: 'Check changes' }] } });
  expect(document.getElementById('review-view')).toBe(null);
  editor.actions.setReviewMode('review');
  await screen.findByText('Working tree is clean');
  editor.actions.setReviewTab('stages');
  const view = required(document.getElementById('review-view'));
  expect(view.classList.contains('layout-vertical')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle layout' }));
  expect(view.classList.contains('layout-horizontal')).toBe(true);
});

test('a pending stage offers a run button and hides an empty question', async () => {
  const editor = mount({ config: { stages: [{ id: 'a', title: 'Check changes', question: '' }] } });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('stages');
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Check changes'),
  );
  expect(screen.getByRole('button', { name: 'Run this stage' })).toBeTruthy();
  expect(document.getElementById('review-question-text')).toBe(null);
  fireEvent.click(screen.getByRole('button', { name: 'Edit this stage' }));
  expect(screen.getByRole('form', { name: 'Edit stage' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form')).toBe(null);
});

test('a configured stage shows its title and question before its first run', async () => {
  const editor = mount({
    config: { stages: [{ id: 'a', title: 'Configured stage', question: 'What changed?' }] },
  });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('stages');
  await waitFor(() =>
    expect(required(document.getElementById('review-question-text'))?.textContent).toBe(
      'What changed?',
    ),
  );
  expect(required(document.getElementById('review-stage-title')).textContent).toBe(
    'Configured stage',
  );
});

test('walkthrough filters list only files with that kind of insight', async () => {
  const editor = mount(
    { config: { stages: [] } },
    {
      totalFiles: 2,
      files: [
        {
          path: 'src/a.go',
          additions: 2,
          understanding: { edgeCases: [{ line: 3, explanation: 'nil' }] },
          hunks: [],
        },
        { path: 'src/b.go', deletions: 1, understanding: {}, hunks: [] },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  await waitFor(() => expect(screen.getAllByTitle('src/b.go')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: /Edge cases/ }));
  expect(screen.queryByTitle('src/b.go')).toBe(null);
  expect(screen.getByText('nil')).toBeTruthy();
});
