import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { EditorProvider } from '../editor/context.tsx';
import { createPREditor, routes } from './test-editor.ts';
import { PRBar } from './PRBar.jsx';
import { CommentsPanel } from './CommentsPanel.jsx';
import { MergeDialog } from './MergeDialog.jsx';
import { RowComposers } from './RowComments.jsx';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));

const replies = {
  'api/pr/comments': {
    comments: [{ id: 'd1', path: 'a.go', line: 3, side: 'RIGHT', body: 'nit' }],
  },
  'api/pr/existing-comments': {
    issueComments: [
      {
        id: 1,
        author: 'ann',
        body: 'Looks good',
        bodyHtml: '<blockquote><p>[!NOTE] Read</p></blockquote>',
      },
    ],
    reviewComments: [{ id: 5, path: 'a.go', line: 3, author: 'bob', body: 'Why?' }],
  },
  'api/pr/merge-status': {
    canMerge: true,
    base: 'main',
    commits: [],
    status: { state: 'clean', methods: ['merge', 'squash'] },
    defaults: {
      squash: { title: 'Fix (#7)', message: '' },
      merge: { title: 'Merge', message: '' },
    },
  },
};
function mount(post = vi.fn(async () => ({}))) {
  let editor;
  render(() => {
    editor = createPREditor({ request: routes(replies), post });
    return (
      <EditorProvider value={editor}>
        <PRBar />
        <CommentsPanel />
        <MergeDialog />
        <RowComposers path="a.go" rows={[{ newLine: 4 }]} />
      </EditorProvider>
    );
  });
  editor.actions.initializePR();
  return editor;
}

test('the bar shows the PR, its merge state and the review verdicts', async () => {
  const post = vi.fn(async () => ({}));
  const editor = mount(post);
  expect(screen.getByText('Fix the parser')).toBeTruthy();
  await screen.findByText('Ready to merge');
  fireEvent.click(document.getElementById('pr-review-toggle'));
  fireEvent.input(screen.getByRole('textbox', { name: 'Review summary' }), {
    target: { value: 'LGTM' },
  });
  fireEvent.click(document.getElementById('pr-submit-approve'));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      'api/pr/submit',
      { event: 'APPROVE', body: 'LGTM' },
      expect.anything(),
    ),
  );
  await waitFor(() => expect(editor.pr.state.drafts).toHaveLength(0));
});

test('the merge caret lists the allowed methods and opens the dialog for one', async () => {
  mount();
  await screen.findByText('Ready to merge');
  fireEvent.click(screen.getByRole('button', { name: 'Choose how to merge' }));
  const items = screen.getAllByRole('menuitemradio');
  expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  fireEvent.click(items[0]);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.textContent).toMatch(/Confirm merge/));
});

test('the comments panel lists the conversation and code threads and posts a comment', async () => {
  const post = vi.fn(async (path, body) => ({ id: 2, author: 'me', ...body }));
  const editor = mount(post);
  const panel = document.getElementById('pr-comments-panel');
  expect(panel.classList.contains('collapsed')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand/collapse comments panel' }));
  expect(panel.classList.contains('collapsed')).toBe(false);
  await screen.findByText('a.go:3');
  expect(document.getElementById('pr-comments-count').textContent).toBe('3');
  expect(document.querySelector('.thr-alert-title').textContent).toBe('Note');
  fireEvent.input(screen.getByRole('textbox', { name: 'Pull request comment' }), {
    target: { value: 'Thanks' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(editor.pr.state.issueComments).toHaveLength(2));
  expect(post).toHaveBeenCalledWith('api/pr/comments/issue', { body: 'Thanks' }, expect.anything());
});

test('a composer opens under its diff row with focus and closes on Escape', async () => {
  const editor = mount();
  editor.actions.openPRComposer({ path: 'a.go', l1: 4, l2: 4 });
  const input = await screen.findByRole('textbox', { name: 'Review comment' });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Review comment' })).toBe(null);
});
