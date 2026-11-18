import { createAppStore } from '../app/store.ts';
import { prMeta } from './test-editor.ts';
import { required } from '../lib/test-values.ts';
import { record } from '../lib/decode.ts';
import { createEditorStore } from '../editor/store.ts';
import type { EditorStore } from '../editor/store.ts';
import type { Request } from '../lib/api.ts';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { EditorProvider } from '../editor/context.tsx';
import { createPREditor, routes } from './test-editor.ts';
import { Activity } from './Activity.tsx';
import { ReviewView } from '../review/ReviewView.tsx';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const replies = {
  'api/pr/comments': { comments: [] },
  'api/pr/existing-comments': {
    issueComments: [
      { id: 1, author: 'ann', body: 'First thought', createdAt: '2026-01-01T10:00:00Z' },
      { id: 2, author: 'bob', body: 'Latest thought', createdAt: '2026-01-03T10:00:00Z' },
    ],
    reviewComments: [
      {
        id: 5,
        path: 'a.go',
        line: 3,
        side: 'RIGHT',
        author: 'cat',
        body: 'Why?',
        createdAt: '2026-01-02T10:00:00Z',
      },
    ],
  },
  'api/pr/overview': { description: {} },
  'api/review/walkthrough': { files: [], totalFiles: 0 },
  'api/pr/merge-status': { canMerge: false, status: { state: 'clean', methods: ['merge'] } },
};

function mountActivity(
  request: Request = routes(replies),
  post: Request = vi.fn(async () => ({})),
) {
  let editor: ReturnType<typeof createPREditor> | undefined;
  render(() => {
    editor = createPREditor({ meta: prMeta(), request, post });
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
        <Activity />
      </EditorProvider>
    );
  });
  required(editor).actions.initializePR();
  return required(editor);
}

test('activity lists issue comments and review threads in time order with icons and a count', async () => {
  mountActivity();
  await waitFor(() =>
    expect(document.querySelectorAll('[data-ui="pr-activity-item"]')).toHaveLength(3),
  );
  const rows = [...document.querySelectorAll<HTMLElement>('[data-ui="pr-activity-item"]')];
  expect(rows.map((row) => row.dataset.kind)).toEqual(['issue', 'thread', 'issue']);
  expect(rows.map((row) => required(row.querySelector('details')).open)).toEqual([
    true,
    true,
    true,
  ]);
  expect(rows[0]?.textContent).toContain('First thought');
  expect(rows[1]?.textContent).toContain('a.go:3');
  expect(rows[2]?.textContent).toContain('Latest thought');
  expect(rows[0]?.querySelector('.icon-\\[ph--chat-circle\\]')).not.toBeNull();
  expect(rows[1]?.querySelector('.icon-\\[ph--eye\\]')).not.toBeNull();
  expect(rows[2]?.querySelector('.icon-\\[ph--chat-circle\\]')).not.toBeNull();
  const heading = required(document.querySelector('[aria-label="Activity"] h2'));
  expect(heading.textContent).toContain('Activity');
  expect(required(heading.querySelector('span')).textContent).toBe('3');
});

test('a reader can fold one entry away and the rest stay open', async () => {
  const editor = mountActivity();
  await waitFor(() =>
    expect(document.querySelectorAll('[data-ui="pr-activity-item"]')).toHaveLength(3),
  );
  const thread = required(
    document.querySelector<HTMLDetailsElement>('[data-kind="thread"] details'),
  );
  expect(thread.open).toBe(true);
  fireEvent.click(required(thread.querySelector('summary')));
  expect(thread.open).toBe(false);
  await waitFor(() => expect(editor.pr.state.expanded['thread:a.go|RIGHT:3']).toBe(false));
  expect(
    required(document.querySelector<HTMLDetailsElement>('[data-kind="issue"] details')).open,
  ).toBe(true);
});

test('activity shows the empty state and keeps the composer when nothing is said', async () => {
  mountActivity(
    routes({
      ...replies,
      'api/pr/existing-comments': { issueComments: [], reviewComments: [] },
    }),
  );
  await screen.findByText('No comments yet. Select lines in the diff to comment on the code.');
  expect(document.querySelector('[data-ui="pr-activity-item"]')).toBe(null);
  expect(document.getElementById('pr-issue-compose-body')).not.toBe(null);
  expect(document.getElementById('pr-issue-compose-send')).not.toBe(null);
});

test('the composer posts a pull request comment with Mod+Enter', async () => {
  const post = vi.fn(async (_path: string, body?: unknown) => ({
    id: 9,
    author: 'me',
    ...record(body),
  }));
  const editor = mountActivity(undefined, post);
  await waitFor(() =>
    expect(document.querySelectorAll('[data-ui="pr-activity-item"]')).toHaveLength(3),
  );
  const input = required(document.querySelector<HTMLTextAreaElement>('#pr-issue-compose-body'));
  fireEvent.input(input, { target: { value: 'Thanks' } });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(editor.pr.state.issueComments).toHaveLength(3));
  expect(post).toHaveBeenCalledWith('api/pr/comments/issue', { body: 'Thanks' }, expect.anything());
  expect(input.value).toBe('');
});

function mountReview() {
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true, pr: prMeta() });
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    const feature = { request: routes(replies) };
    editor = createEditorStore(app, { review: feature, pr: feature, merge: feature });
    editor.actions.setReviewMode('review');
    return (
      <EditorProvider value={editor}>
        <ReviewView />
      </EditorProvider>
    );
  });
  return required(editor);
}

test('revealing a line thread selects Overview and scrolls the thread into view', async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const editor = mountReview();
  editor.actions.initializePR();
  await waitFor(() =>
    expect(document.querySelectorAll('[data-ui="pr-activity-item"]')).toHaveLength(3),
  );
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('No changes in this pull request');
  expect(document.getElementById('pr-overview')).toBe(null);
  editor.actions.revealPRThread('thread:a.go|RIGHT:3');
  expect(editor.review.state.tab).toBe('overview');
  expect(
    required(document.getElementById('btn-review-tab-overview')).getAttribute('aria-selected'),
  ).toBe('true');
  const thread = required(
    document.querySelector<HTMLDetailsElement>('[data-kind="thread"] details'),
  );
  expect(thread.open).toBe(true);
  expect(scroll).toHaveBeenCalled();
  expect(editor.pr.state.reveal).toEqual({ key: 'thread:a.go|RIGHT:3', sequence: 1 });
});
