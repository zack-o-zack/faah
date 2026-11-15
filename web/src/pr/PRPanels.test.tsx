import { decodeAgentJob } from '../agents/job-decode.ts';
import { PRPanels } from './PRPanels.tsx';
import { createAppStore } from '../app/store.ts';
import { prMeta } from './test-editor.ts';
import { required } from '../lib/test-values.ts';
import { record } from '../lib/decode.ts';
import { createEditorStore } from '../editor/store.ts';
import type { Request } from '../lib/api.ts';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { EditorProvider } from '../editor/context.tsx';
import { createPREditor, routes } from './test-editor.ts';
import { PRBar } from './PRBar.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { MergeDialog } from './MergeDialog.tsx';
import { RowComposers } from './RowComments.tsx';

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
function mount(
  post: Request = vi.fn(async () => ({})),
  mergeReply: object = replies['api/pr/merge-status'],
) {
  let editor: ReturnType<typeof createPREditor> | undefined;
  render(() => {
    editor = createPREditor({
      request: routes({ ...replies, 'api/pr/merge-status': mergeReply }),
      post,
    });
    const base = createEditorStore(editor.store);
    const view = {
      ...base,
      pr: editor.pr,
      merge: editor.merge,
      forge: editor.forge,
      actions: {
        ...base.actions,
        ...editor.pr.actions,
        ...editor.merge.actions,
        ...editor.forge.actions,
      },
    };
    return (
      <EditorProvider value={view}>
        <PRBar />
        <CommentsPanel />
        <MergeDialog />
        <RowComposers path="a.go" rows={[{ newLine: 4 }]} />
      </EditorProvider>
    );
  });
  required(editor).actions.initializePR();
  return required(editor);
}

test('the bar shows the PR, its merge state and the review verdicts', async () => {
  const post = vi.fn(async () => ({}));
  const editor = mount(post);
  expect(screen.getByText('Fix the parser')).toBeTruthy();
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-review-toggle')));
  fireEvent.input(screen.getByRole('textbox', { name: 'Review summary' }), {
    target: { value: 'LGTM' },
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Approve' }));
  fireEvent.click(required(document.getElementById('pr-review-submit')));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      'api/pr/submit',
      { event: 'APPROVE', body: 'LGTM' },
      expect.anything(),
    ),
  );
  await waitFor(() => expect(editor.pr.state.drafts).toHaveLength(0));
});

test('Merge bar opens the dialog, and its split CTA selects without merging', async () => {
  const editor = mount();
  await screen.findByText('Ready to merge');
  expect(document.getElementById('pr-merge-caret')).toBeNull();
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  expect(document.getElementById('pr-merge-methods')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose merge method' }));
  const items = screen.getAllByRole('menuitemradio');
  expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  fireEvent.click(required(items[0]));
  expect(editor.merge.state.dialog.method).toBe('merge');
  expect(required(document.getElementById('pr-merge-confirm')).textContent).toContain(
    'Create a merge commit',
  );
});

test('the comments panel lists the conversation and code threads and posts a comment', async () => {
  const post = vi.fn(async (_path: string, body?: unknown) => ({
    id: 2,
    author: 'me',
    ...record(body),
  }));
  const editor = mount(post);
  const panel = required(document.getElementById('pr-comments-panel'));
  expect(panel.classList.contains('collapsed')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand/collapse comments panel' }));
  expect(panel.classList.contains('collapsed')).toBe(false);
  await screen.findByText('a.go:3');
  expect(required(document.getElementById('pr-comments-count')).textContent).toBe('3');
  expect(required(document.querySelector<HTMLElement>('.thr-alert-title')).textContent).toBe(
    'Note',
  );
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

test('Overview keeps the existing PR comments panel rendered', () => {
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true, pr: prMeta() });
    const editor = createEditorStore(app, { review: { request: async () => ({}) } });
    editor.actions.setReviewMode('review');
    return (
      <EditorProvider value={editor}>
        <PRPanels />
      </EditorProvider>
    );
  });
  expect(document.getElementById('pr-comments-panel')).not.toBeNull();
});

test('review selection resets on open, honors gate reasons, and disables the CTA while sending', async () => {
  let finish: (() => void) | undefined;
  const editor = mount(
    async () =>
      new Promise<object>((resolve) => {
        finish = () => resolve({});
      }),
  );
  await screen.findByText('Ready to merge');
  vi.spyOn(editor.merge, 'gate').mockReturnValue({
    all: '',
    approve: 'Push first',
    approveNote: '',
  });
  fireEvent.click(required(document.getElementById('pr-review-toggle')));
  const approve = screen.getByRole<HTMLButtonElement>('radio', { name: 'Approve' });
  expect(approve.disabled).toBe(true);
  expect(approve.title).toBe('Push first');
  fireEvent.click(screen.getByRole('radio', { name: 'Request changes' }));
  fireEvent.click(required(document.getElementById('pr-review-toggle')));
  fireEvent.click(required(document.getElementById('pr-review-toggle')));
  expect(screen.getByRole('radio', { name: 'Comment' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(required(document.getElementById('pr-review-submit')));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sending…' }).disabled).toBe(true);
  finish?.();
  await waitFor(() => expect(editor.pr.state.review.pending).toBe(''));
});

test('merge label stays Merge for every selected method, remembers selection, and hides a single-method caret', async () => {
  const editor = mount(undefined, {
    ...replies['api/pr/merge-status'],
    status: { state: 'clean', methods: ['merge', 'squash', 'rebase'] },
  });
  await screen.findByText('Ready to merge');
  for (const method of ['merge', 'squash', 'rebase']) {
    editor.actions.chooseMergeMethod(method);
    expect(required(document.getElementById('pr-merge')).textContent).toBe('Merge');
    expect(editor.merge.method()).toBe(method);
    expect(editor.merge.state.dialog.open).toBe(false);
  }
});

test('only one allowed method hides the merge caret', async () => {
  mount(undefined, {
    ...replies['api/pr/merge-status'],
    status: { state: 'clean', methods: ['squash'] },
  });
  await screen.findByText('Ready to merge');
  expect(document.getElementById('pr-merge-caret')).toBeNull();
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  expect(document.getElementById('pr-merge-method-caret')).toBeNull();
});

test('review panel uses one viewport-bounded width and end alignment near the right edge', async () => {
  mount();
  await screen.findByText('Ready to merge');
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(448);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(850, 600, 42, 32),
  );
  fireEvent.click(required(document.getElementById('pr-review-toggle')));
  const panel = screen.getByRole('dialog', { name: 'Send a review' });
  await waitFor(() => expect(panel.style.left).toBe('444px'));
  expect(panel.className).toContain('w-[min(28rem,calc(100vw-1rem))]');
  expect(panel.firstElementChild?.className).toContain('w-full');
});

test('dialog method menu switches fields, retains drafts, and confirms with the selected method', async () => {
  const post = vi.fn(async () => ({}));
  const editor = mount(post, {
    ...replies['api/pr/merge-status'],
    status: { state: 'clean', methods: ['merge', 'squash', 'rebase'] },
  });
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-merge')));
  const dialog = await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  fireEvent.input(screen.getByRole('textbox', { name: 'Commit title' }), {
    target: { value: 'Saved draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose merge method' }));
  const menu = screen.getByRole('menu', { name: 'Choose merge method' });
  expect(dialog.contains(menu)).toBe(true);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Rebase and merge/ }));
  expect(screen.queryByRole('textbox', { name: 'Commit title' })).toBeNull();
  expect(document.getElementById('pr-merge-commit-list')).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose merge method' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Squash and merge/ }));
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Commit title' }).value).toBe(
    'Saved draft',
  );
  editor.actions.chooseMergeMethod('rebase');
  fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      'api/pr/merge',
      expect.objectContaining({ method: 'rebase' }),
    ),
  );
});

test('merge AI disclosure toggles for commit methods, focuses instructions, and is absent for rebase', async () => {
  const editor = mount(undefined, {
    ...replies['api/pr/merge-status'],
    status: { state: 'clean', methods: ['merge', 'squash', 'rebase'] },
  });
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  expect(document.getElementById('pr-merge-ai-checkbox')).toBeNull();
  for (const method of ['squash', 'merge']) {
    editor.actions.chooseMergeMethod(method);
    expect(document.getElementById('pr-merge-ai-row')).toBeNull();
    const toggle = screen.getByRole<HTMLButtonElement>('button', { name: 'Rewrite with AI' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Rewrite instructions' }),
      ),
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(document.getElementById('pr-merge-ai-row')).toBeNull();
  }
  editor.actions.chooseMergeMethod('rebase');
  expect(screen.queryByRole('button', { name: 'Rewrite with AI' })).toBeNull();
});

test('merge and comment shortcuts are chips inside their buttons with no separate hint', async () => {
  const editor = mount();
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  expect(document.querySelector('#pr-merge-confirm kbd')).not.toBeNull();
  expect(document.querySelector('#pr-merge-cancel kbd')?.textContent).toBe('Esc');
  expect(screen.queryByText(/to merge · Esc to cancel/)).toBeNull();
  fireEvent.click(required(document.getElementById('pr-merge-cancel')));
  editor.actions.openPRComposer({ path: 'a.go', l1: 4, l2: 4 });
  await screen.findByRole('textbox', { name: 'Review comment' });
  expect(screen.getByRole('button', { name: /Add Comment/ }).querySelector('kbd')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Cancel' }).querySelector('kbd')?.textContent).toBe(
    'Esc',
  );
  expect(screen.queryByText(/to add, Esc to cancel/)).toBeNull();
});

test('reset message is an icon, derives disabled state from defaults, and restores edited fields', async () => {
  mount();
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  const reset = screen.getByRole<HTMLButtonElement>('button', { name: 'Reset to default message' });
  expect(reset.disabled).toBe(true);
  expect(reset.textContent?.trim()).toBe('');
  fireEvent.input(screen.getByRole('textbox', { name: 'Commit message' }), {
    target: { value: 'Edited' },
  });
  expect(reset.disabled).toBe(false);
  fireEvent.click(reset);
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Commit message' }).value).toBe(
    '',
  );
  expect(reset.disabled).toBe(true);
});

test('AI disclosure and reset stay disabled during a rewrite', async () => {
  const editor = mount();
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  editor.actions.runAgentJob.mockImplementation(async () => {
    await pending;
    return decodeAgentJob({ stdout: 'AI title\n\nAI body' });
  });
  await screen.findByText('Ready to merge');
  fireEvent.click(required(document.getElementById('pr-merge')));
  await screen.findByRole('dialog', { name: 'Merge pull request #7' });
  const toggle = screen.getByRole<HTMLButtonElement>('button', { name: 'Rewrite with AI' });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
  expect(toggle.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Reset to default message' }).disabled,
  ).toBe(true);
  finish?.();
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Commit title' }).value).toBe(
    'AI title',
  );
});
